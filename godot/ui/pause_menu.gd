class_name PauseMenu
extends CanvasLayer
## In-match pause overlay: Resume, Settings, Leave match. The match keeps running on the server, so
## this only covers the screen; it does not stop the clock. Hook for the match scene:
##
##   var pause := PauseMenu.new()
##   add_child(pause)
##   pause.leave_pressed.connect(_leave_match)
##   # on the "pause" action (and nothing to cancel): pause.toggle()
##   # while pause.is_open(): ignore match input.

signal resume_pressed
signal leave_pressed

var _root: Control
var _resume_button: Button
var _menu_column: Control
var _settings: SettingsMenu


func _init() -> void:
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	_root = Control.new()
	_root.theme = MenuStyle.theme()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.visible = false
	add_child(_root)

	var dim := ColorRect.new()
	dim.color = Color(0.08, 0.05, 0.02, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(center)
	_menu_column = PanelContainer.new()
	_menu_column.custom_minimum_size = Vector2(380, 0)
	center.add_child(_menu_column)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	_menu_column.add_child(col)

	var title := Label.new()
	title.text = "Paused"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.label_settings = MenuStyle.heading(48, Color("ffd23f"), 10)
	col.add_child(title)
	_resume_button = _button("Resume", MenuStyle.GREEN, close)
	col.add_child(_resume_button)
	col.add_child(_button("Settings", MenuStyle.BLUE, _open_settings))
	col.add_child(_button("Leave match", MenuStyle.RED, func() -> void: leave_pressed.emit()))


func _button(text: String, color: Color, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	MenuStyle.paint(b, color, 26)
	b.pressed.connect(on_press)
	return b


## B on a pad backs out of the pause menu (the settings screen handles its own B).
func _input(ev: InputEvent) -> void:
	if is_open() and _settings == null and ev is InputEventJoypadButton and ev.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		close()


func is_open() -> bool:
	return _root != null and _root.visible


func open() -> void:
	if _root == null:
		return
	_root.visible = true
	# Focus the first button so a pad can pick straight away.
	_resume_button.grab_focus.call_deferred()
	if DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func close() -> void:
	if _settings != null:
		_settings.queue_free()
		_settings = null
	if _root != null:
		_root.visible = false
	resume_pressed.emit()


func toggle() -> void:
	if is_open():
		if _settings != null:
			_close_settings()
		else:
			close()
	else:
		open()


func _open_settings() -> void:
	if _settings != null:
		return
	_settings = SettingsMenu.new()
	_settings.closed.connect(_close_settings)
	_root.add_child(_settings)
	_menu_column.visible = false


func _close_settings() -> void:
	if _settings != null:
		_settings.queue_free()
		_settings = null
	_menu_column.visible = true
	_resume_button.grab_focus.call_deferred()
