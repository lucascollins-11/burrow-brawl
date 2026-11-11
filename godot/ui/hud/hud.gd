class_name Hud
extends CanvasLayer
## Match HUD for up to 8 teams: turn banner and timer, turn-order strip, compact team bars, wind gauge,
## minimap, aim crosshair with a power bar, and the end-of-match banner. Built in code so the scene
## file stays tiny. Data comes from ViewModel.snapshot(); the numbers are worked out in HudModel.

signal skip_pressed
signal leave_pressed
signal again_pressed

const INK := Color("3b2a1a")
const CREAM := Color("fff8ea")

var _banner_label: Label
var _timer_label: Label
var _order_box: HBoxContainer
var _teams_box: VBoxContainer
var _wind: WindGauge
var _minimap: Minimap
var _cross: Crosshair
var _power_panel: PanelContainer
var _power_label: Label
var _power_bar: ProgressBar
var _hint: Label
var _weapon: Label
var _skip: Button
var _end_panel: PanelContainer
var _end_label: Label
var _again: Button
var _shown_key: String = ""


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.name = "Root"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# Banner with the timer, top centre.
	var banner := _panel(14)
	banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP, Control.PRESET_MODE_MINSIZE, 10)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	banner.add_child(row)
	_timer_label = _label(26, true)
	_banner_label = _label(18, true)
	row.add_child(_timer_label)
	row.add_child(_banner_label)
	root.add_child(banner)

	_order_box = HBoxContainer.new()
	_order_box.add_theme_constant_override("separation", 6)
	_order_box.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP, Control.PRESET_MODE_MINSIZE, 68)
	root.add_child(_order_box)

	# Team bars, top right.
	var teams_panel := _panel(10)
	teams_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT, Control.PRESET_MODE_MINSIZE, 10)
	teams_panel.custom_minimum_size = Vector2(210, 0)
	_teams_box = VBoxContainer.new()
	_teams_box.add_theme_constant_override("separation", 4)
	teams_panel.add_child(_teams_box)
	root.add_child(teams_panel)

	# Wind gauge, top left.
	var wind_panel := _panel(12)
	wind_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT, Control.PRESET_MODE_MINSIZE, 10)
	_wind = WindGauge.new()
	_wind.custom_minimum_size = Vector2(96, 96)
	wind_panel.add_child(_wind)
	root.add_child(wind_panel)

	# Minimap, bottom left.
	var map_panel := _panel(8)
	map_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT, Control.PRESET_MODE_MINSIZE, 10)
	_minimap = Minimap.new()
	_minimap.custom_minimum_size = Vector2(150, 150)
	map_panel.add_child(_minimap)
	root.add_child(map_panel)

	# Aim crosshair in the middle and the power bar under it.
	_cross = Crosshair.new()
	_cross.set_anchors_preset(Control.PRESET_CENTER)
	_cross.visible = false
	root.add_child(_cross)
	_power_panel = _panel(10)
	_power_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM, Control.PRESET_MODE_MINSIZE, 60)
	var pv := VBoxContainer.new()
	_power_label = _label(15, true)
	_power_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_power_bar = ProgressBar.new()
	_power_bar.custom_minimum_size = Vector2(260, 14)
	_power_bar.show_percentage = false
	_power_bar.max_value = 100.0
	_power_bar.add_theme_stylebox_override("fill", _flat(Color("e85d4a"), 6, 0))
	_power_bar.add_theme_stylebox_override("background", _flat(Color("e6d7bd"), 6, 0))
	pv.add_child(_power_label)
	pv.add_child(_power_bar)
	_power_panel.add_child(pv)
	_power_panel.visible = false
	root.add_child(_power_panel)

	# Weapon name and skip button, bottom right; hint, bottom centre.
	var bottom := _panel(8)
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT, Control.PRESET_MODE_MINSIZE, 10)
	var brow := HBoxContainer.new()
	brow.add_theme_constant_override("separation", 10)
	_weapon = _label(16, true)
	_skip = Button.new()
	_skip.text = "Skip turn"
	_skip.pressed.connect(func() -> void: skip_pressed.emit())
	brow.add_child(_weapon)
	brow.add_child(_skip)
	bottom.add_child(brow)
	root.add_child(bottom)
	_hint = _label(13, false)
	_hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM, Control.PRESET_MODE_MINSIZE, 8)
	root.add_child(_hint)

	# End of match.
	_end_panel = _panel(22)
	_end_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER, Control.PRESET_MODE_MINSIZE)
	var ev := VBoxContainer.new()
	ev.add_theme_constant_override("separation", 12)
	_end_label = _label(34, true)
	_end_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_again = Button.new()
	_again.text = "Back to lobby"
	_again.pressed.connect(func() -> void: again_pressed.emit())
	var leave := Button.new()
	leave.text = "Leave"
	leave.pressed.connect(func() -> void: leave_pressed.emit())
	ev.add_child(_end_label)
	ev.add_child(_again)
	ev.add_child(leave)
	_end_panel.add_child(ev)
	_end_panel.visible = false
	root.add_child(_end_panel)


## Refresh from a snapshot. `aim` may be null; `world` is the map's footprint (x, z) for the minimap.
func update(
	v: Dictionary, aim: CameraMath.AimState, hint: String, weapon_name: String, world: Vector2
) -> void:
	var over: bool = v["phase"] == "over"
	_timer_label.text = str(ceili(float(v["time_left"]))) if v["phase"] == "control" else ""
	_banner_label.text = HudModel.turn_banner(v)

	var sums := HudModel.summarize_teams(v)
	var order := HudModel.turn_order(v)
	var key := JSON.stringify([sums.map(_sum_key), order])
	if key != _shown_key:
		_shown_key = key
		_rebuild_teams(sums, order)

	var w := HudModel.wind_streamer(v["wind"])
	_wind.heading_deg = w["heading_deg"]
	_wind.strength = w["strength"]
	_wind.label = (
		"calm" if float(w["strength"]) == 0.0
		else "%d %s" % [int(roundf(float(w["strength"]) * 100.0)), HudModel.compass(float(w["heading_deg"]))]
	)
	_wind.queue_redraw()
	_minimap.world = world
	_minimap.view = v
	_minimap.queue_redraw()

	_cross.visible = aim != null
	_power_panel.visible = aim != null
	if aim != null:
		_power_label.text = "Power %d - aim %d deg" % [int(roundf(aim.power)), aim.pitch_deg]
		_power_bar.value = aim.power
	_weapon.text = weapon_name
	_skip.disabled = not (v["my_turn"] and (v["phase"] == "control" or v["phase"] == "retreat"))
	_hint.text = "" if over else hint
	_end_panel.visible = over
	if over:
		_end_label.text = HudModel.turn_banner(v)


static func _sum_key(s: Dictionary) -> Array:
	return [s["index"], s["alive"], s["hp"], s["active"]]


func _rebuild_teams(sums: Array, order: Array) -> void:
	for c in _teams_box.get_children():
		c.queue_free()
	for s in sums:
		var row := VBoxContainer.new()
		var top := HBoxContainer.new()
		var name_label := _label(13, bool(s["active"]))
		name_label.text = str(s["name"])
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var count := _label(13, false)
		count.text = "%d/%d" % [s["alive"], s["total"]]
		top.add_child(name_label)
		top.add_child(count)
		var bar := ProgressBar.new()
		bar.custom_minimum_size = Vector2(0, 8)
		bar.show_percentage = false
		bar.max_value = 1.0
		bar.value = s["fraction"]
		bar.add_theme_stylebox_override("fill", _flat(s["color"], 4, 0))
		bar.add_theme_stylebox_override("background", _flat(Color("e6d7bd"), 4, 0))
		row.add_child(top)
		row.add_child(bar)
		row.modulate = Color(1, 1, 1, 0.4 if s["out"] else 1.0)
		if s["active"]:
			var hl := _flat(Color("ffd23f", 0.55), 8, 0)
			var pc := PanelContainer.new()
			pc.add_theme_stylebox_override("panel", hl)
			pc.add_child(row)
			_teams_box.add_child(pc)
		else:
			_teams_box.add_child(row)
	for c in _order_box.get_children():
		c.queue_free()
	var first := true
	for idx in order:
		var dot := Panel.new()
		var size := 30.0 if first else 22.0
		dot.custom_minimum_size = Vector2(size, size)
		var sb := _flat(TeamStyle.color_of(int(idx)), int(size / 2.0), 3)
		sb.border_color = INK
		dot.add_theme_stylebox_override("panel", sb)
		_order_box.add_child(dot)
		first = false


static func _flat(color: Color, radius: int, border: int) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(border)
	sb.border_color = INK
	return sb


static func _panel(radius: int) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := _flat(CREAM, radius, 3)
	sb.set_content_margin_all(8)
	p.add_theme_stylebox_override("panel", sb)
	return p


static func _label(size: int, bold: bool) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", INK)
	l.set_meta("bold", bold)
	return l


## Wind gauge: an arrow that turns to the wind heading and grows with its strength.
class WindGauge:
	extends Control
	var heading_deg: float = 0.0
	var strength: float = 0.0
	var label: String = "calm"

	func _draw() -> void:
		var c := size * 0.5 - Vector2(0, 8)
		draw_arc(c, 30.0, 0.0, TAU, 32, Color("3b2a1a"), 2.0)
		# Heading 0 = +z (south on the map, down on screen), 90 = +x (east, right).
		var ang := deg_to_rad(heading_deg)
		var dir := Vector2(sin(ang), cos(ang))
		var len := 10.0 + strength * 22.0
		var tip := c + dir * len
		var side := Vector2(-dir.y, dir.x)
		draw_line(c - dir * len * 0.6, tip, Color("e85d4a"), 4.0)
		draw_colored_polygon(
			PackedVector2Array([tip + dir * 8.0, tip + side * 6.0, tip - side * 6.0]), Color("e85d4a")
		)
		draw_string(
			ThemeDB.fallback_font,
			Vector2(0, size.y - 2.0),
			label,
			HORIZONTAL_ALIGNMENT_CENTER,
			size.x,
			14,
			Color("3b2a1a")
		)


## Minimap: the island from above with team-coloured dots; the active critter is ringed.
class Minimap:
	extends Control
	var world: Vector2 = Vector2(256, 256)
	var view: Dictionary = {}

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color("bfe3f5"), true)
		draw_rect(Rect2(Vector2.ZERO, size), Color("3b2a1a"), false, 2.0)
		if view.is_empty() or world.x <= 0.0 or world.y <= 0.0:
			return
		for c in view["critters"]:
			if not c["alive"]:
				continue
			var p: Vector3 = c["pos"]
			var at := Vector2(p.x / world.x * size.x, p.z / world.y * size.y)
			draw_circle(at, 4.0, TeamStyle.color_of(int(c["team"])))
			if view["active_critter_id"] != null and c["id"] == int(view["active_critter_id"]):
				draw_arc(at, 7.0, 0.0, TAU, 16, Color("ffd23f"), 2.0)
		for s in view["projectiles"]:
			var q: Vector3 = s["pos"]
			draw_circle(Vector2(q.x / world.x * size.x, q.z / world.y * size.y), 2.0, Color("3b2a1a"))


## Aim crosshair in the middle of the screen.
class Crosshair:
	extends Control

	func _draw() -> void:
		draw_arc(Vector2.ZERO, 16.0, 0.0, TAU, 24, Color("3b2a1a"), 5.0)
		draw_arc(Vector2.ZERO, 16.0, 0.0, TAU, 24, Color.WHITE, 2.5)
		draw_circle(Vector2.ZERO, 2.5, Color("e85d4a"))
