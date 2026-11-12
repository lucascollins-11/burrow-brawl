class_name MenuStyle
extends RefCounted
## Shared look of the menus: chunky rounded buttons with a dark outline, cream cards, big outlined
## headings. Everything is built in code (no image files), so it stays reviewable as text.

const INK := Color("3b2a1a")
const CREAM := Color("fff6e4")
const PAPER := Color("ffe9c4")
const ORANGE := Color("ff8a3d")
const GREEN := Color("5cc46a")
const BLUE := Color("4aa3df")
const RED := Color("e85d4a")
const GREY := Color("b9ad9c")


static func box(bg: Color, radius: int = 14, border: int = 3, pad: int = 12, lift: int = 4) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(border)
	sb.border_width_bottom = border + lift
	sb.border_color = INK
	sb.content_margin_left = pad + 6
	sb.content_margin_right = pad + 6
	sb.content_margin_top = pad
	sb.content_margin_bottom = pad + lift
	sb.anti_aliasing = true
	return sb


## The theme for a whole menu screen. Set it on the root Control.
static func theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 20
	_button_styles(t, "Button", CREAM)
	t.set_color("font_color", "Button", INK)
	t.set_color("font_hover_color", "Button", INK)
	t.set_color("font_pressed_color", "Button", INK)
	t.set_color("font_focus_color", "Button", INK)
	t.set_color("font_disabled_color", "Button", Color(INK, 0.45))
	t.set_font_size("font_size", "Button", 20)

	_button_styles(t, "OptionButton", CREAM)
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		t.set_color(c, "OptionButton", INK)
	t.set_color("font_disabled_color", "OptionButton", Color(INK, 0.7))
	t.set_stylebox("panel", "PopupMenu", box(CREAM, 12, 3, 6, 0))
	t.set_stylebox("hover", "PopupMenu", box(PAPER.darkened(0.08), 8, 0, 2, 0))
	for c in ["font_color", "font_hover_color"]:
		t.set_color(c, "PopupMenu", INK)
	t.set_font_size("font_size", "PopupMenu", 20)

	var edit := box(Color.WHITE, 12, 3, 10, 0)
	var edit_focus := box(Color.WHITE, 12, 3, 10, 0)
	edit_focus.border_color = ORANGE
	t.set_stylebox("normal", "LineEdit", edit)
	t.set_stylebox("focus", "LineEdit", edit_focus)
	t.set_stylebox("read_only", "LineEdit", edit)
	t.set_color("font_color", "LineEdit", INK)
	t.set_color("font_placeholder_color", "LineEdit", Color(INK, 0.45))
	t.set_color("caret_color", "LineEdit", INK)
	t.set_color("selection_color", "LineEdit", Color(ORANGE, 0.4))
	t.set_font_size("font_size", "LineEdit", 22)

	t.set_color("font_color", "Label", INK)
	t.set_font_size("font_size", "Label", 20)
	t.set_stylebox("panel", "PanelContainer", box(CREAM, 20, 4, 18, 4))
	return t


static func _button_styles(t: Theme, type: String, color: Color) -> void:
	t.set_stylebox("normal", type, box(color))
	t.set_stylebox("hover", type, box(color.lightened(0.18)))
	var pressed := box(color.darkened(0.08), 14, 3, 12, 0)
	pressed.content_margin_top = 16
	pressed.content_margin_bottom = 12
	t.set_stylebox("pressed", type, pressed)
	t.set_stylebox("disabled", type, box(GREY.lightened(0.25)))
	var focus := StyleBoxFlat.new()
	focus.draw_center = false
	focus.set_corner_radius_all(16)
	focus.set_border_width_all(2)
	focus.border_color = Color(1, 1, 1, 0.9)
	t.set_stylebox("focus", type, focus)


## Give one button its own colour (for the big actions) and optionally a bigger label.
static func paint(button: Button, color: Color, font_size: int = 20) -> void:
	button.add_theme_stylebox_override("normal", box(color))
	button.add_theme_stylebox_override("hover", box(color.lightened(0.18)))
	var pressed := box(color.darkened(0.08), 14, 3, 12, 0)
	pressed.content_margin_top = 16
	pressed.content_margin_bottom = 12
	button.add_theme_stylebox_override("pressed", pressed)
	button.add_theme_font_size_override("font_size", font_size)


## Big outlined text for headings and the logo.
static func heading(size: int, color: Color = Color.WHITE, outline: int = 10) -> LabelSettings:
	var s := LabelSettings.new()
	s.font_size = size
	s.font_color = color
	s.outline_size = outline
	s.outline_color = INK
	s.shadow_size = 0
	s.shadow_color = Color(INK, 0.55)
	s.shadow_offset = Vector2(0, maxf(3.0, float(size) * 0.08))
	return s


## A small rounded tag such as HOST or READY.
static func chip(text: String, color: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(10)
	sb.set_border_width_all(2)
	sb.border_color = INK
	sb.content_margin_left = 9
	sb.content_margin_right = 9
	sb.content_margin_top = 1
	sb.content_margin_bottom = 2
	panel.add_theme_stylebox_override("panel", sb)
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", 14)
	label.add_theme_color_override("font_color", INK)
	panel.add_child(label)
	return panel


## A cream card with a heading; returns the VBox to fill.
static func card(parent: Node, title: String) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	panel.add_child(col)
	if title != "":
		var head := Label.new()
		head.text = title
		head.add_theme_font_size_override("font_size", 26)
		col.add_child(head)
	return col
