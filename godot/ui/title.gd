## Title screen: nickname, create a room, or join one by code.
extends Control

const LOBBY_SCENE := "res://ui/lobby.tscn"

var _nick_edit: LineEdit
var _code_edit: LineEdit
var _create_button: Button
var _join_button: Button
var _status: Label


func _ready() -> void:
	_build()
	_nick_edit.text = Net.nickname
	Net.entered_room.connect(_on_entered_room)
	Net.enter_failed.connect(_on_enter_failed)


func _build() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.99, 0.93, 0.85)  # warm paper; the real look comes in G2
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(360, 0)
	box.add_theme_constant_override("separation", 12)
	center.add_child(box)

	var title := Label.new()
	title.text = "Burrow Brawl"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 48)
	box.add_child(title)

	_nick_edit = LineEdit.new()
	_nick_edit.placeholder_text = "Nickname (2 to 16 characters)"
	_nick_edit.max_length = Proto.NICKNAME_MAX
	box.add_child(_nick_edit)

	_create_button = Button.new()
	_create_button.text = "Create room"
	_create_button.pressed.connect(_on_create_pressed)
	box.add_child(_create_button)

	var join_row := HBoxContainer.new()
	box.add_child(join_row)
	_code_edit = LineEdit.new()
	_code_edit.placeholder_text = "Room code"
	_code_edit.max_length = Proto.ROOM_CODE_LENGTH
	_code_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	join_row.add_child(_code_edit)
	_join_button = Button.new()
	_join_button.text = "Join by code"
	_join_button.pressed.connect(_on_join_pressed)
	join_row.add_child(_join_button)

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_status)

	var server_label := Label.new()
	server_label.text = "Server: " + NetConfig.server_base()
	server_label.modulate = Color(0, 0, 0, 0.5)
	box.add_child(server_label)


func _on_create_pressed() -> void:
	_begin("create", "")


func _on_join_pressed() -> void:
	_begin("join", _code_edit.text)


func _begin(mode: String, code: String) -> void:
	var nick := Proto.valid_nickname(_nick_edit.text)
	if nick == "":
		_show("Pick a nickname of 2 to 16 characters first.", true)
		return
	_set_busy(true)
	_show("Connecting. The server can take up to a minute to wake up.", false)
	Net.enter_room(mode, nick, code)


func _on_entered_room() -> void:
	get_tree().change_scene_to_file.call_deferred(LOBBY_SCENE)


func _on_enter_failed(message: String) -> void:
	_set_busy(false)
	_show(message, true)


func _set_busy(busy: bool) -> void:
	_create_button.disabled = busy
	_join_button.disabled = busy


func _show(text: String, is_error: bool) -> void:
	_status.text = text
	_status.modulate = Color(0.7, 0, 0) if is_error else Color(0, 0, 0)
