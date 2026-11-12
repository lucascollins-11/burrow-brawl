class_name Hud
extends CanvasLayer
## Match HUD for up to 8 teams: turn banner and timer, turn-order strip, compact team bars, wind gauge,
## minimap, aim crosshair with a power bar, and the end-of-match banner. Built in code so the scene
## file stays tiny. Data comes from ViewModel.snapshot(); the numbers are worked out in HudModel.

signal skip_pressed
signal weapon_picked(index: int)
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
var _weapon_grid: WeaponGrid
var _weapon_menu_button: Button
var _weapon_buttons: Array[Button] = []
var _weapon_names: Array[String] = ["Acorn Mortar", "Fizz Grenade"]
## Ammo per weapon id for the grid (-1 is unlimited). Only what the sim can fire today; the match
## replaces this with the real table through set_arsenal().
var _arsenal: Dictionary = {"acorn-mortar": -1, "fizz-grenade": -1}
var _end_rows: VBoxContainer
var _skip: Button
var _end_panel: PanelContainer
var _end_label: Label
var _again: Button
var _shown_key: String = ""

## Screenshot and test hooks, for the e2e screenshot scene only: nothing in the live game sets them,
## so do not build features on them. While `preview_aim` is set, the HUD draws that aim (crosshair and
## power bar) whatever the controls say. While `preview_view` is set (see sample_results), the HUD
## draws that snapshot instead of the live one, which is how the results screen is shown without
## finishing a match. The e2e scene must reset them (null and {}) right after each shot; while one is
## left set the live HUD never comes back.
var preview_aim: CameraMath.AimState = null
var preview_view: Dictionary = {}


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.name = "Root"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# Banner with the timer, top centre.
	var banner := _panel(14)
	_place(banner, Control.PRESET_CENTER_TOP, 10)
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
	_place(_order_box, Control.PRESET_CENTER_TOP, 68)
	root.add_child(_order_box)

	# Team bars, top right.
	var teams_panel := _panel(10)
	_place(teams_panel, Control.PRESET_TOP_RIGHT, 10)
	teams_panel.custom_minimum_size = Vector2(210, 0)
	_teams_box = VBoxContainer.new()
	_teams_box.add_theme_constant_override("separation", 4)
	teams_panel.add_child(_teams_box)
	root.add_child(teams_panel)

	# Wind gauge, top left.
	var wind_panel := _panel(12)
	_place(wind_panel, Control.PRESET_TOP_LEFT, 10)
	_wind = WindGauge.new()
	_wind.custom_minimum_size = Vector2(96, 96)
	wind_panel.add_child(_wind)
	root.add_child(wind_panel)

	# Minimap, bottom left.
	var map_panel := _panel(8)
	_place(map_panel, Control.PRESET_BOTTOM_LEFT, 10)
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
	_place(_power_panel, Control.PRESET_CENTER_BOTTOM, 60)
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
	_place(bottom, Control.PRESET_BOTTOM_RIGHT, 10)
	var brow := HBoxContainer.new()
	brow.add_theme_constant_override("separation", 10)
	for i in range(_weapon_names.size()):
		var wb := Button.new()
		wb.toggle_mode = true
		wb.text = "%d  %s" % [i + 1, _weapon_names[i]]
		wb.focus_mode = Control.FOCUS_NONE
		wb.pressed.connect(func() -> void: weapon_picked.emit(i))
		_weapon_buttons.append(wb)
		brow.add_child(wb)
	_weapon_menu_button = Button.new()
	_weapon_menu_button.text = "Weapons"
	_weapon_menu_button.focus_mode = Control.FOCUS_NONE
	_weapon_menu_button.pressed.connect(func() -> void: _weapon_grid.toggle())
	brow.add_child(_weapon_menu_button)
	_skip = Button.new()
	_skip.text = "Skip turn"
	_skip.pressed.connect(func() -> void: skip_pressed.emit())
	_skip.focus_mode = Control.FOCUS_NONE
	brow.add_child(_skip)
	bottom.add_child(brow)
	root.add_child(bottom)
	# The full arsenal grid pops up above the bottom bar.
	_weapon_grid = WeaponGrid.new()
	_weapon_grid.set_current(_weapon_id(0))
	_weapon_grid.set_ammo(_arsenal)
	_weapon_grid.picked.connect(_on_weapon_id_picked)
	_place(_weapon_grid, Control.PRESET_BOTTOM_RIGHT, 10)
	_weapon_grid.offset_bottom = -72.0
	root.add_child(_weapon_grid)
	_hint = _label(13, false)
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_hint, Control.PRESET_CENTER_BOTTOM, 8)
	root.add_child(_hint)

	# End of match: winner banner, standings and the way out.
	_end_panel = _panel(24)
	_place(_end_panel, Control.PRESET_CENTER, 0)
	_end_panel.custom_minimum_size = Vector2(380, 0)
	var ev := VBoxContainer.new()
	ev.add_theme_constant_override("separation", 12)
	_end_label = _label(36, true)
	_end_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_end_rows = VBoxContainer.new()
	_end_rows.add_theme_constant_override("separation", 6)
	_again = Button.new()
	_again.text = "Back to lobby"
	_again.custom_minimum_size = Vector2(0, 44)
	_again.add_theme_font_size_override("font_size", 20)
	_again.pressed.connect(func() -> void: again_pressed.emit())
	var leave := Button.new()
	leave.text = "Leave"
	leave.pressed.connect(func() -> void: leave_pressed.emit())
	ev.add_child(_end_label)
	ev.add_child(_end_rows)
	ev.add_child(_again)
	ev.add_child(leave)
	_end_panel.add_child(ev)
	_end_panel.visible = false
	root.add_child(_end_panel)


## Refresh from a snapshot. `aim` may be null; `world` is the map's footprint (x, z) for the minimap.
## Give the weapon grid the ammo table: weapon id -> count (-1 unlimited, 0 or missing: unavailable).
func set_arsenal(ammo: Dictionary) -> void:
	_arsenal = ammo
	if _weapon_grid != null:
		_weapon_grid.set_ammo(ammo)


func _weapon_id(index: int) -> String:
	if index >= 0 and index < Controls.WEAPONS.size():
		return str(Controls.WEAPONS[index]["id"])
	return ""


## A grid pick becomes the same weapon_picked(index) the quick slots send, when Controls knows it.
func _on_weapon_id_picked(id: String) -> void:
	for i in range(Controls.WEAPONS.size()):
		if Controls.WEAPONS[i]["id"] == id:
			weapon_picked.emit(i)
			return


func _unhandled_input(ev: InputEvent) -> void:
	if ev.is_action_pressed("weapon_menu") and _weapon_grid != null:
		_weapon_grid.toggle()
	elif ev.is_action_pressed("cancel_aim") and _weapon_grid != null and _weapon_grid.visible:
		_weapon_grid.close()
		get_viewport().set_input_as_handled()


func update(
	v: Dictionary, aim: CameraMath.AimState, hint: String, weapon_name: String, world: Vector2
) -> void:
	if not preview_view.is_empty():
		v = preview_view
	if preview_aim != null:
		aim = preview_aim
	var over: bool = v["phase"] == "over"
	var left := float(v["time_left"])
	_timer_label.text = str(ceili(left)) if v["phase"] == "control" else ""
	var urgent: bool = v["phase"] == "control" and left <= 5.0
	_timer_label.add_theme_color_override("font_color", Color("d93b2b") if urgent else INK)
	_timer_label.pivot_offset = _timer_label.size * 0.5
	_timer_label.scale = Vector2.ONE * (1.0 + (0.18 * (1.0 - fposmod(left, 1.0)) if urgent else 0.0))
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
	for i in range(_weapon_buttons.size()):
		_weapon_buttons[i].set_pressed_no_signal(_weapon_names[i] == weapon_name)
	for i in range(_weapon_names.size()):
		if weapon_name.begins_with(_weapon_names[i]):
			_weapon_grid.set_current(_weapon_id(i))
	_skip.disabled = not (v["my_turn"] and (v["phase"] == "control" or v["phase"] == "retreat"))
	_hint.text = "" if over else hint
	_end_panel.visible = over
	if over:
		_end_label.text = HudModel.turn_banner(v)
		_fill_standings(v)


var _standings_key: String = ""


func _fill_standings(v: Dictionary) -> void:
	var rows := HudModel.standings(v)
	var key := JSON.stringify(rows.map(func(r: Dictionary) -> Array: return [r["index"], r["alive"], r["hp"]]))
	if key == _standings_key:
		return
	_standings_key = key
	for c in _end_rows.get_children():
		c.queue_free()
	for r in rows:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var swatch := Panel.new()
		swatch.custom_minimum_size = Vector2(22, 22)
		var sb := _flat(r["color"], 11, 3)
		swatch.add_theme_stylebox_override("panel", sb)
		var rank := _label(18, bool(r["winner"]))
		rank.text = "%d." % int(r["rank"])
		var nm := _label(18, bool(r["winner"]))
		nm.text = ("%s  (winner)" % r["name"]) if r["winner"] else str(r["name"])
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var left := _label(16, false)
		left.text = "%d/%d left" % [r["alive"], r["total"]]
		row.add_child(rank)
		row.add_child(swatch)
		row.add_child(nm)
		row.add_child(left)
		row.modulate = Color(1, 1, 1, 0.55 if r["out"] else 1.0)
		_end_rows.add_child(row)


## A finished-match snapshot with made-up standings, for the results screen: `team_count` teams
## of two critters each, team `winner` has one survivor, the others are dead or hurt in team order.
static func sample_results(winner: int = 0, team_count: int = 4) -> Dictionary:
	var teams: Array = []
	var critters: Array = []
	var id := 1
	for t in range(team_count):
		teams.append(TeamStyle.default_look(t))
		for k in range(2):
			var alive: bool = (t == winner and k == 0) or (t != winner and k == 0 and t % 2 == 1)
			critters.append(
				{
					"id": id,
					"team": t,
					"name": "Squirmling %d" % id,
					"pos": Vector3.ZERO,
					"heading_deg": 0.0,
					"hp": (100 - t * 15) if alive else 0,
					"max_hp": 100,
					"alive": alive,
					"grounded": true,
				}
			)
			id += 1
	return {
		"teams": teams,
		"critters": critters,
		"projectiles": [],
		"active_critter_id": null,
		"active_team": null,
		"phase": "over",
		"round": 7,
		"turn": 23,
		"time_left": 0.0,
		"wind": Vector2.ZERO,
		"sea_y": 5.0,
		"winner_team": winner,
		"my_turn": false,
	}


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
		count.text = "x" if s["out"] else "%d/%d  %d hp" % [s["alive"], s["total"], s["hp"]]
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


## Margin kept between the HUD and the screen edge.
const EDGE := 16


## Put a control on the screen by preset and keep it inside the screen however its content grows:
## panels on the right or bottom grow towards the middle, centred ones grow both ways. (The old
## anchors fixed the offsets while the panel was still empty, so panels filled later ran off the edge.)
static func _place(c: Control, preset: int, margin: int) -> void:
	c.set_anchors_preset(preset)
	var right := preset in [Control.PRESET_TOP_RIGHT, Control.PRESET_BOTTOM_RIGHT, Control.PRESET_CENTER_RIGHT]
	var bottom := preset in [Control.PRESET_BOTTOM_LEFT, Control.PRESET_BOTTOM_RIGHT, Control.PRESET_CENTER_BOTTOM]
	var left := preset in [Control.PRESET_TOP_LEFT, Control.PRESET_BOTTOM_LEFT, Control.PRESET_CENTER_LEFT]
	var top := preset in [Control.PRESET_TOP_LEFT, Control.PRESET_TOP_RIGHT, Control.PRESET_CENTER_TOP]
	c.grow_horizontal = (
		Control.GROW_DIRECTION_BEGIN if right else (Control.GROW_DIRECTION_END if left else Control.GROW_DIRECTION_BOTH)
	)
	c.grow_vertical = (
		Control.GROW_DIRECTION_BEGIN if bottom else (Control.GROW_DIRECTION_END if top else Control.GROW_DIRECTION_BOTH)
	)
	# Offsets are the distance from the anchor towards the screen's middle.
	var edge_x := float(EDGE if (left or right) else 0)
	var edge_y := float((EDGE if (left or right) else margin) if (top or bottom) else 0)
	c.offset_left = edge_x if left else (-edge_x if right else 0.0)
	c.offset_right = c.offset_left
	c.offset_top = edge_y if top else (-edge_y if bottom else 0.0)
	c.offset_bottom = c.offset_top


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
