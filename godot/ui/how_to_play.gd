## How-to-play pages, opened from the title screen. Seven short pages, each with a plain text and a
## simple drawing made of shapes (no image files). Next and Back move through them; Close or Escape
## leaves. The text is plain data in PAGES so a test can check it.
class_name HowToPlay
extends Control

signal closed

const PAGES: Array[Dictionary] = [
	{
		"art": "goal",
		"title": "The goal",
		"text": "Every team has squirmlings. Blow up the other teams' squirmlings, or push them into the soda sea. The last team with a squirmling left wins.",
	},
	{
		"art": "turns",
		"title": "Turns",
		"text": "Teams take turns. Each turn has a timer, 45 seconds by default, and it turns red in the last 5. After you fire, you get a few seconds to get clear. Stuck? Backspace skips your turn.",
	},
	{
		"art": "move",
		"title": "Move and jump",
		"text": "W, A, S and D walk your squirmling around, relative to the camera. Space jumps. Enter does a backflip. Drag the mouse to turn the camera, and use the wheel to zoom.",
	},
	{
		"art": "aim",
		"title": "Aim and fire",
		"text": "Press Tab or F to enter aim mode, then move the mouse to aim. Hold F to charge power, and let go to fire. Esc leaves aim mode.",
	},
	{
		"art": "wind",
		"title": "Wind",
		"text": "The gauge in the top-left shows the wind. Shots drift with it, so aim a little into the wind.",
	},
	{
		"art": "weapons",
		"title": "Weapons",
		"text": "Press 1 for the Acorn Mortar, which lands and blasts the ground. Press 2 for the Fizz Grenade, which bounces. Set its fuse with Z and X.",
	},
	{
		"art": "water",
		"title": "Water and falls",
		"text": "Anything that falls into the soda sea is knocked out. Explosions carve holes in the ground, so one good blast can drop a whole team's squirmlings into the sea.",
	},
]

var _index := 0
var _count: Label
var _art: Art
var _title: Label
var _text: Label
var _back: Button
var _next: Button


## How many pages there are.
static func page_count() -> int:
	return PAGES.size()


## One page by index. Out-of-range indexes are clamped to the first or last page.
static func page(i: int) -> Dictionary:
	return PAGES[clampi(i, 0, PAGES.size() - 1)]


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	theme = MenuStyle.theme()
	mouse_filter = Control.MOUSE_FILTER_STOP

	var shade := ColorRect.new()
	shade.color = Color(0.10, 0.07, 0.04, 0.55)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(shade)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)

	var head := HBoxContainer.new()
	box.add_child(head)
	var heading := Label.new()
	heading.text = "How to play"
	heading.label_settings = MenuStyle.heading(30, Color("ffd23f"), 10)
	heading.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(heading)
	_count = Label.new()
	_count.add_theme_font_size_override("font_size", 16)
	head.add_child(_count)

	_art = Art.new()
	_art.custom_minimum_size = Vector2(480, 180)
	box.add_child(_art)

	_title = Label.new()
	_title.label_settings = MenuStyle.heading(24, MenuStyle.INK, 0)
	box.add_child(_title)

	_text = Label.new()
	_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_text.custom_minimum_size = Vector2(480, 84)
	box.add_child(_text)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	box.add_child(row)
	_back = Button.new()
	_back.text = "Back"
	MenuStyle.paint(_back, MenuStyle.GREY, 20)
	_back.pressed.connect(_on_back_pressed)
	row.add_child(_back)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	var close := Button.new()
	close.text = "Close"
	MenuStyle.paint(close, MenuStyle.RED, 20)
	close.pressed.connect(_close)
	row.add_child(close)
	_next = Button.new()
	_next.text = "Next"
	MenuStyle.paint(_next, MenuStyle.GREEN, 20)
	_next.pressed.connect(_on_next_pressed)
	row.add_child(_next)

	_show(0)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_close()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("ui_right"):
		_on_next_pressed()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("ui_left"):
		_on_back_pressed()
		get_viewport().set_input_as_handled()


func _show(i: int) -> void:
	_index = clampi(i, 0, PAGES.size() - 1)
	var p := page(_index)
	_count.text = "%d / %d" % [_index + 1, PAGES.size()]
	_title.text = str(p["title"])
	_text.text = str(p["text"])
	_art.show_art(str(p["art"]))
	_back.disabled = _index == 0
	_next.text = "Done" if _index == PAGES.size() - 1 else "Next"


func _on_next_pressed() -> void:
	if _index >= PAGES.size() - 1:
		_close()
	else:
		_show(_index + 1)


func _on_back_pressed() -> void:
	_show(_index - 1)


func _close() -> void:
	closed.emit()
	queue_free()


## The drawing for one page. Every picture is built from rectangles, circles, lines and triangles.
class Art:
	extends Control

	var _kind := "goal"

	func show_art(kind: String) -> void:
		_kind = kind
		queue_redraw()

	func _draw() -> void:
		var box_size := get_rect().size
		var mid := box_size * 0.5
		var font := get_theme_default_font()
		draw_rect(Rect2(Vector2.ZERO, box_size), Color(MenuStyle.PAPER, 0.6))
		match _kind:
			"goal":
				_star(mid, 62.0, 26.0, MenuStyle.ORANGE)
				_squirmling(mid + Vector2(-150, 30), 0.9, MenuStyle.BLUE)
				_squirmling(mid + Vector2(150, 30), 0.9, MenuStyle.RED)
			"turns":
				draw_arc(mid, 62.0, 0.0, TAU, 48, MenuStyle.INK, 6.0)
				draw_line(mid, mid + Vector2(0, -46), MenuStyle.INK, 6.0)
				draw_line(mid, mid + Vector2(34, 14), MenuStyle.RED, 5.0)
				draw_circle(mid, 7.0, MenuStyle.INK)
				draw_string(font, mid + Vector2(-30, 80), "45 s", HORIZONTAL_ALIGNMENT_CENTER, 60, 20, MenuStyle.INK)
			"move":
				_arrow(mid + Vector2(0, -60), Vector2(0, -1))
				_arrow(mid + Vector2(0, 60), Vector2(0, 1))
				_arrow(mid + Vector2(-110, 0), Vector2(-1, 0))
				_arrow(mid + Vector2(110, 0), Vector2(1, 0))
				_squirmling(mid, 1.0, MenuStyle.ORANGE)
			"aim":
				var start_at := mid + Vector2(-170, 20)
				var peak := mid + Vector2(-20, -70)
				var land := mid + Vector2(150, 20)
				_dashed_arc(start_at, peak, land)
				_squirmling(start_at, 0.7, MenuStyle.BLUE)
				draw_rect(Rect2(mid + Vector2(-170, 62), Vector2(340, 16)), MenuStyle.INK)
				draw_rect(Rect2(mid + Vector2(-166, 66), Vector2(230, 8)), MenuStyle.GREEN)
			"wind":
				draw_line(mid + Vector2(-150, -10), mid + Vector2(120, -10), MenuStyle.INK, 8.0)
				draw_colored_polygon(
					PackedVector2Array([mid + Vector2(150, -10), mid + Vector2(96, -38), mid + Vector2(96, 18)]),
					MenuStyle.INK
				)
				for k in range(3):
					var y := mid.y + 30.0 + k * 22.0
					draw_polyline(_wave(Vector2(mid.x - 150, y), 300.0), Color(MenuStyle.INK, 0.6), 4.0)
			"weapons":
				draw_circle(mid + Vector2(-100, 0), 52.0, Color("8a5a2b"))
				draw_string(font, mid + Vector2(-140, 74), "1  Acorn Mortar", HORIZONTAL_ALIGNMENT_CENTER, 80, 18, MenuStyle.INK)
				draw_circle(mid + Vector2(100, 0), 40.0, MenuStyle.BLUE)
				draw_string(font, mid + Vector2(60, 74), "2  Fizz Grenade", HORIZONTAL_ALIGNMENT_CENTER, 80, 18, MenuStyle.INK)
			"water":
				draw_rect(Rect2(Vector2(0, mid.y + 20), box_size), Color(MenuStyle.BLUE, 0.85))
				draw_polyline(_wave(Vector2(0, mid.y + 20), box_size.x), Color.WHITE, 4.0)
				_squirmling(mid + Vector2(0, -40), 0.8, MenuStyle.ORANGE)

	func _star(c: Vector2, outer: float, inner: float, color: Color) -> void:
		var pts := PackedVector2Array()
		for k in range(10):
			var r := outer if k % 2 == 0 else inner
			var a := -PI * 0.5 + k * PI / 5.0
			pts.append(c + Vector2(cos(a), sin(a)) * r)
		draw_colored_polygon(pts, color)

	## A squirmling as a few stacked rings and a head, the same idea as the game model.
	func _squirmling(c: Vector2, scale_by: float, color: Color) -> void:
		for k in range(4):
			var tint := color if k % 2 == 0 else Color.WHITE
			draw_circle(c + Vector2(0, -k * 16.0 * scale_by), 18.0 * scale_by, tint)
		draw_circle(c + Vector2(0, -68.0 * scale_by), 16.0 * scale_by, color.lightened(0.2))
		draw_circle(c + Vector2(-5.0 * scale_by, -70.0 * scale_by), 3.0 * scale_by, MenuStyle.INK)
		draw_circle(c + Vector2(5.0 * scale_by, -70.0 * scale_by), 3.0 * scale_by, MenuStyle.INK)

	func _arrow(c: Vector2, dir: Vector2) -> void:
		var side := Vector2(-dir.y, dir.x)
		var tip := c + dir * 30.0
		draw_colored_polygon(
			PackedVector2Array([tip, c - dir * 14.0 + side * 18.0, c - dir * 14.0 - side * 18.0]),
			MenuStyle.INK
		)

	func _dashed_arc(a: Vector2, peak: Vector2, b: Vector2) -> void:
		var prev := a
		for k in range(1, 25):
			var t := float(k) / 24.0
			var p := a.lerp(peak, t).lerp(peak.lerp(b, t), t)
			if k % 2 == 1:
				draw_line(prev, p, MenuStyle.INK, 5.0)
			prev = p

	func _wave(start: Vector2, width: float) -> PackedVector2Array:
		var pts := PackedVector2Array()
		var steps := 40
		for k in range(steps + 1):
			var x := start.x + width * float(k) / float(steps)
			pts.append(Vector2(x, start.y + sin(float(k) * 0.9) * 6.0))
		return pts
