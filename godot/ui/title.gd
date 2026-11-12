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
	Audio.play_music("menu")
	_nick_edit.text = Net.nickname
	Net.entered_room.connect(_on_entered_room)
	Net.enter_failed.connect(_on_enter_failed)


func _build() -> void:
	theme = MenuStyle.theme()
	add_child(MenuBackdrop.new())

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 18)
	center.add_child(column)

	var logo := Label.new()
	logo.text = "BURROW BRAWL"
	logo.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	logo.label_settings = MenuStyle.heading(84, Color("ffd23f"), 16)
	column.add_child(logo)

	var tagline := Label.new()
	tagline.text = "Squirmlings. Soda sea. Very large holes."
	tagline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tagline.label_settings = MenuStyle.heading(24, Color.WHITE, 6)
	column.add_child(tagline)

	var card_row := CenterContainer.new()
	column.add_child(card_row)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(460, 0)
	card_row.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)

	var nick_label := Label.new()
	nick_label.text = "Your name"
	box.add_child(nick_label)
	_nick_edit = LineEdit.new()
	_nick_edit.placeholder_text = "2 to 16 characters"
	_nick_edit.max_length = Proto.NICKNAME_MAX
	box.add_child(_nick_edit)

	_create_button = Button.new()
	_create_button.text = "Create room"
	MenuStyle.paint(_create_button, MenuStyle.ORANGE, 28)
	_create_button.pressed.connect(_on_create_pressed)
	box.add_child(_create_button)

	var or_label := Label.new()
	or_label.text = "or join a friend"
	or_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	or_label.modulate = Color(1, 1, 1, 0.7)
	box.add_child(or_label)

	var join_row := HBoxContainer.new()
	join_row.add_theme_constant_override("separation", 10)
	box.add_child(join_row)
	_code_edit = LineEdit.new()
	_code_edit.placeholder_text = "Room code"
	_code_edit.max_length = Proto.ROOM_CODE_LENGTH
	_code_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_code_edit.text_submitted.connect(func(_t: String) -> void: _on_join_pressed())
	join_row.add_child(_code_edit)
	_join_button = Button.new()
	_join_button.text = "Join"
	MenuStyle.paint(_join_button, MenuStyle.BLUE, 22)
	_join_button.pressed.connect(_on_join_pressed)
	join_row.add_child(_join_button)


	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size = Vector2(0, 52)
	box.add_child(_status)

	# Two smaller buttons side by side under the main actions.
	var extras := HBoxContainer.new()
	extras.add_theme_constant_override("separation", 10)
	box.add_child(extras)
	var help_button := Button.new()
	help_button.text = "How to play"
	help_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	MenuStyle.paint(help_button, MenuStyle.GREEN, 20)
	help_button.pressed.connect(_on_help_pressed)
	extras.add_child(help_button)
	var settings_button := Button.new()
	settings_button.text = "Settings"
	settings_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	settings_button.pressed.connect(_open_settings)
	extras.add_child(settings_button)

	var server_label := Label.new()
	server_label.text = "Server: " + NetConfig.server_base()
	server_label.add_theme_font_size_override("font_size", 13)
	server_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.75))
	server_label.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT, Control.PRESET_MODE_MINSIZE, 10)
	server_label.grow_vertical = Control.GROW_DIRECTION_BEGIN
	add_child(server_label)


func _open_settings() -> void:
	var menu := SettingsMenu.new()
	menu.closed.connect(menu.queue_free)
	add_child(menu)


func _on_help_pressed() -> void:
	# The tutorial sits over the title. It frees itself when closed.
	add_child(HowToPlay.new())


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
	_status.add_theme_color_override("font_color", Color("c0392b") if is_error else MenuStyle.INK)
