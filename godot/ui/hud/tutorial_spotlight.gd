## A pulsing yellow frame drawn around one HUD control, used by the practice tutorial to point at the
## thing a step is about. It ignores the mouse and draws only while it has a target.
class_name TutorialSpotlight
extends Control

const COLOR := Color("ffd23f")
const PAD := 8.0

var _rect := Rect2()
var _on := false
var _time := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false


## Frame `target` (a control on screen), or hide the frame when target is null or not shown.
func point_at(target: Control) -> void:
	if target == null or not target.is_visible_in_tree():
		_on = false
		visible = false
		return
	_rect = target.get_global_rect().grow(PAD)
	_on = true
	visible = true
	queue_redraw()


func _process(delta: float) -> void:
	if not _on:
		return
	_time += delta
	queue_redraw()


func _draw() -> void:
	if not _on:
		return
	var pulse := 0.6 + 0.4 * sin(_time * 4.0)
	draw_rect(_rect, Color(COLOR, pulse), false, 4.0)
	draw_rect(_rect.grow(5.0), Color(COLOR, pulse * 0.35), false, 3.0)
