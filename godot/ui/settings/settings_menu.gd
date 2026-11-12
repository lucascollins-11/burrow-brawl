class_name SettingsMenu
extends Control
## The settings screen: sound, video and controls tabs. An overlay (dimmed backdrop and a centred
## card) so the title screen and the in-match pause menu can both show it. Emits `closed` when the
## player presses Back. Every change applies and saves at once (GameSettings).

signal closed

const TABS := ["Sound", "Video", "Controls"]

var _tabs: TabContainer
var _rebinding: String = ""
var _key_buttons: Dictionary = {}  # action id -> Button
var _status: Label


func _ready() -> void:
	theme = MenuStyle.theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.08, 0.05, 0.02, 0.62)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(760, 560)
	center.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	panel.add_child(column)

	var title := Label.new()
	title.text = "Settings"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.label_settings = MenuStyle.heading(44, Color("ffd23f"), 10)
	column.add_child(title)

	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tabs.add_child(_sound_tab())
	_tabs.add_child(_video_tab())
	_tabs.add_child(_controls_tab())
	for i in range(TABS.size()):
		_tabs.set_tab_title(i, TABS[i])
	column.add_child(_tabs)

	_status = Label.new()
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_status.custom_minimum_size = Vector2(0, 26)
	column.add_child(_status)

	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 14)
	column.add_child(row)
	var reset := Button.new()
	reset.text = "Reset all"
	reset.pressed.connect(_on_reset)
	row.add_child(reset)
	var back := Button.new()
	back.text = "Back"
	MenuStyle.paint(back, MenuStyle.ORANGE, 24)
	back.custom_minimum_size = Vector2(180, 0)
	back.pressed.connect(close)
	row.add_child(back)


func close() -> void:
	_stop_rebinding()
	closed.emit()


# ------------------------------------------------------------------ tabs


func _page(page_name: String) -> VBoxContainer:
	var page := VBoxContainer.new()
	page.name = page_name
	page.add_theme_constant_override("separation", 14)
	return page


func _row(parent: Node, label: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	parent.add_child(row)
	var l := Label.new()
	l.text = label
	l.custom_minimum_size = Vector2(230, 0)
	row.add_child(l)
	return row


func _slider(parent: Node, label: String, value: float, lo: float, hi: float, step: float, on_change: Callable, fmt: String) -> HSlider:
	var row := _row(parent, label)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.custom_minimum_size = Vector2(0, 28)
	row.add_child(s)
	var readout := Label.new()
	readout.custom_minimum_size = Vector2(70, 0)
	readout.text = fmt % value
	row.add_child(readout)
	s.value_changed.connect(
		func(v: float) -> void:
			readout.text = fmt % v
			on_change.call(v)
	)
	return s


func _options(parent: Node, label: String, items: Array, selected: int, on_pick: Callable) -> OptionButton:
	var row := _row(parent, label)
	var o := OptionButton.new()
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for item in items:
		o.add_item(str(item))
	o.select(selected)
	o.item_selected.connect(on_pick)
	row.add_child(o)
	return o


func _check(parent: Node, label: String, on: bool, on_toggle: Callable) -> CheckButton:
	var row := _row(parent, label)
	var c := CheckButton.new()
	c.button_pressed = on
	c.toggled.connect(on_toggle)
	row.add_child(c)
	return c


func _sound_tab() -> Control:
	var page := _page("Sound")
	_slider(page, "Master volume", GameSettings.master_volume, 0.0, 1.0, 0.05, GameSettings.set_master_volume, "%.2f")
	_slider(page, "Music", GameSettings.music_volume, 0.0, 1.0, 0.05, GameSettings.set_music_volume, "%.2f")
	var sfx := _slider(page, "Sound effects", GameSettings.sfx_volume, 0.0, 1.0, 0.05, GameSettings.set_sfx_volume, "%.2f")
	# Let go of the effects slider and you hear a sample of what you set.
	sfx.drag_ended.connect(func(_changed: bool) -> void: _preview_sfx())
	return page


func _preview_sfx() -> void:
	var audio := get_node_or_null("/root/Audio")
	if audio != null:
		audio.call("play", "explosion", 1.0, 0.0, "small")


func _video_tab() -> Control:
	var page := _page("Video")
	var modes := _options(page, "Window mode", GameSettings.WINDOW_MODES, GameSettings.window_mode, GameSettings.set_window_mode)
	var res_names: Array = []
	for r in GameSettings.RESOLUTIONS:
		res_names.append("%d x %d" % [r.x, r.y])
	var res := _options(page, "Resolution (windowed)", res_names, GameSettings.resolution_index, GameSettings.set_resolution)
	res.disabled = GameSettings.window_mode != 0
	_check(page, "Vsync", GameSettings.vsync, GameSettings.set_vsync)
	_options(page, "Quality", GameSettings.QUALITIES, GameSettings.quality, GameSettings.set_quality)
	var note := Label.new()
	note.text = "Quality sets shadows, edge smoothing and glow."
	note.modulate = Color(1, 1, 1, 0.6)
	page.add_child(note)
	# The resolution list only applies to the windowed mode.
	modes.item_selected.connect(func(i: int) -> void: res.disabled = i != 0)
	return page


func _controls_tab() -> Control:
	var page := _page("Controls")
	_slider(page, "Mouse sensitivity", GameSettings.sensitivity, GameSettings.SENSITIVITY_MIN, GameSettings.SENSITIVITY_MAX, 0.05, GameSettings.set_sensitivity, "%.2fx")
	_check(page, "Invert vertical aim", GameSettings.invert_y, GameSettings.set_invert_y)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	page.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 6)
	scroll.add_child(list)
	var group := ""
	for a in GameSettings.ACTIONS:
		if a["group"] != group:
			group = a["group"]
			var head := Label.new()
			head.text = group
			head.add_theme_color_override("font_color", MenuStyle.ORANGE.darkened(0.2))
			head.add_theme_font_size_override("font_size", 22)
			list.add_child(head)
		var id: String = a["id"]
		var row := _row(list, a["label"])
		(row.get_child(0) as Control).custom_minimum_size = Vector2(340, 0)
		var b := Button.new()
		b.custom_minimum_size = Vector2(190, 0)
		b.pressed.connect(_start_rebinding.bind(id))
		row.add_child(b)
		_key_buttons[id] = b
		if int(a["alt"]) != 0:
			var alt := Label.new()
			alt.text = "also " + GameSettings.key_label(int(a["alt"]))
			alt.modulate = Color(1, 1, 1, 0.6)
			row.add_child(alt)
	var reset := Button.new()
	reset.text = "Reset keys"
	reset.pressed.connect(
		func() -> void:
			GameSettings.reset_keys()
			_stop_rebinding()
			_refresh_keys()
			_say("Keys back to the defaults.")
	)
	page.add_child(reset)
	_refresh_keys()
	return page


# ------------------------------------------------------------------ rebinding


func _refresh_keys() -> void:
	for id in _key_buttons:
		var b: Button = _key_buttons[id]
		if id == _rebinding:
			b.text = "Press a key..."
		else:
			b.text = GameSettings.key_label(int(GameSettings.keys.get(id, 0)))


func _start_rebinding(id: String) -> void:
	_rebinding = id
	_refresh_keys()
	_say("Press the new key. Esc cancels.")


func _stop_rebinding() -> void:
	_rebinding = ""
	_refresh_keys()


func _input(ev: InputEvent) -> void:
	if _rebinding == "" or not (ev is InputEventKey):
		return
	var k := ev as InputEventKey
	if not k.pressed or k.echo:
		return
	get_viewport().set_input_as_handled()
	if k.physical_keycode == KEY_ESCAPE:
		_stop_rebinding()
		_say("")
		return
	var id := _rebinding
	var swapped := GameSettings.rebind(id, int(k.physical_keycode))
	_rebinding = ""
	_refresh_keys()
	if swapped != "":
		_say("%s swapped with %s." % [GameSettings.action_def(swapped)["label"], GameSettings.action_def(id)["label"]])
	else:
		_say("")


func _on_reset() -> void:
	GameSettings.reset_to_defaults()
	for c in get_children():
		c.queue_free()
	_key_buttons.clear()
	_rebinding = ""
	_build.call_deferred()


func _say(text: String) -> void:
	_status.text = text
