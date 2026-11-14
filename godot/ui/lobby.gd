## Lobby: room code, players, the team list (up to 8 seats), ready, add or remove teams, start.
extends Control

const TITLE_SCENE := "res://ui/title.tscn"
const MATCH_SCENE := "res://game/match_scene.tscn"
const TURN_CHOICES: Array[int] = [20, 30, 45, 60, 90]
const SIZE_WORDS: Array[String] = ["Small", "Medium", "Large"]

var _code_label: Label
var _phase_label: Label
var _members_box: VBoxContainer
var _teams_box: VBoxContainer
var _ready_button: Button
var _add_button: Button
var _remove_button: Button
var _start_button: Button
var _status: Label
var _theme_pick: OptionButton
var _size_pick: OptionButton
var _weather_pick: OptionButton
var _time_pick: OptionButton
var _turn_pick: OptionButton
var _count_pick: OptionButton
var _copy_button: Button
var _leave_button: Button
var _teams_card: Control
var _players_card: Control
var _setup_side: Control
var _cards: HBoxContainer
var _count_widgets: Array[Control] = []
## Practice mode: opened from the Practice button. A solo setup screen (map, size, turn time) with
## one big Start button; the choices are remembered in GameSettings.
var _practice := false
var _practice_turn := 90


func _ready() -> void:
	if not Net.lobby.is_active():
		get_tree().change_scene_to_file.call_deferred(TITLE_SCENE)
		return
	_practice = Net.practice_pending
	Net.practice_pending = false
	_practice_turn = GameSettings.practice_turn
	_build()
	Net.room_changed.connect(_refresh)
	Net.room_left.connect(_on_back_to_title)
	Net.disconnected.connect(_on_disconnected)
	Net.server_error.connect(_on_server_error)
	Net.match_started.connect(_on_match_started)
	if _practice:
		_apply_practice_layout()
		_apply_remembered_choices()
	_refresh()


## Practice shows only the Match card, centred, with a Start practice button.
func _apply_practice_layout() -> void:
	_teams_card.visible = false
	_players_card.visible = false
	_copy_button.visible = false
	_ready_button.visible = false
	for w in _count_widgets:
		w.visible = false
	_leave_button.text = "Back"
	_cards.alignment = BoxContainer.ALIGNMENT_CENTER
	_setup_side.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_setup_side.custom_minimum_size = Vector2(620, 0)
	_start_button.text = "Start practice"
	_status.text = "Pick a map, then start. Your choices are remembered."


## Send the last practice choices to the room, if the server still offers them.
func _apply_remembered_choices() -> void:
	var options := Net.lobby.map_options()
	var patch := {}
	for t: Dictionary in options.get("themes", []):
		if str(t.get("id", "")) == GameSettings.practice_theme:
			patch["mapTheme"] = GameSettings.practice_theme
	if GameSettings.practice_theme == "random":
		patch["mapTheme"] = "random"
	for edge in options.get("sizes", []):
		if int(edge) == GameSettings.practice_size:
			patch["mapSize"] = GameSettings.practice_size
	if not patch.is_empty():
		Net.set_settings(patch)


## Save what the pickers show now as the next practice's starting point.
func _remember_practice() -> void:
	var theme_id := "random"
	if _theme_pick.selected >= 0:
		theme_id = str(_theme_pick.get_item_metadata(_theme_pick.selected))
	var edge := 0
	if _size_pick.selected >= 0:
		edge = int(_size_pick.get_item_metadata(_size_pick.selected))
	GameSettings.set_practice(theme_id, edge, _practice_turn)


func _build() -> void:
	theme = MenuStyle.theme()
	var backdrop := MenuBackdrop.new()
	backdrop.quiet = true
	add_child(backdrop)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["margin_left", "margin_top", "margin_right", "margin_bottom"]:
		margin.add_theme_constant_override(side, 20)
	add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)

	# Header: the room code, big enough to read out to a friend.
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 16)
	box.add_child(header)
	var code_col := VBoxContainer.new()
	code_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(code_col)
	_code_label = Label.new()
	_code_label.label_settings = MenuStyle.heading(46, Color("ffd23f"), 12)
	code_col.add_child(_code_label)
	_phase_label = Label.new()
	_phase_label.label_settings = MenuStyle.heading(22, Color.WHITE, 6)
	code_col.add_child(_phase_label)
	_copy_button = _button(header, "Copy code", _on_copy_pressed)
	_copy_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_leave_button = _button(header, "Leave room", _on_leave_pressed)
	_leave_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	MenuStyle.paint(_leave_button, MenuStyle.RED.lightened(0.25))

	# Two cards side by side: teams (wide) and players.
	var cards := HBoxContainer.new()
	cards.add_theme_constant_override("separation", 20)
	cards.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(cards)
	_cards = cards

	var teams_col := MenuStyle.card(cards, "Teams (up to %d)" % Proto.MAX_TEAMS)
	_teams_card = teams_col.get_parent() as Control
	_teams_card.size_flags_stretch_ratio = 1.6
	_teams_box = VBoxContainer.new()
	_teams_box.add_theme_constant_override("separation", 8)
	teams_col.add_child(_teams_box)
	var team_buttons := HBoxContainer.new()
	team_buttons.add_theme_constant_override("separation", 10)
	teams_col.add_child(team_buttons)
	_add_button = _button(team_buttons, "Add team", _on_add_pressed)
	_remove_button = _button(team_buttons, "Remove last team", _on_remove_pressed)

	var side := VBoxContainer.new()
	side.add_theme_constant_override("separation", 10)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cards.add_child(side)
	_setup_side = side
	var players_col := MenuStyle.card(side, "Players")
	_players_card = players_col.get_parent() as Control
	_players_card.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_members_box = VBoxContainer.new()
	_members_box.add_theme_constant_override("separation", 8)
	players_col.add_child(_members_box)

	# Match setup: the host picks, everyone sees.
	var setup := MenuStyle.card(side, "Match")
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 5)
	setup.add_child(grid)
	_theme_pick = _setting(grid, "Map", "mapTheme")
	_size_pick = _setting(grid, "Size", "mapSize")
	_weather_pick = _setting(grid, "Weather", "weather")
	_time_pick = _setting(grid, "Time of day", "timeOfDay")
	_turn_pick = _setting(grid, "Turn time", "turnSeconds")
	for secs in TURN_CHOICES:
		_turn_pick.add_item("%d seconds" % secs)
		_turn_pick.set_item_metadata(_turn_pick.item_count - 1, secs)
	_count_pick = _setting(grid, "Squirmlings each", "crittersPerTeam")
	var count_label := grid.get_child(grid.get_child_count() - 2) as Control
	_count_widgets = [count_label, _count_pick]
	for n in range(1, 5):
		_count_pick.add_item(str(n))
		_count_pick.set_item_metadata(_count_pick.item_count - 1, n)

	# Footer: status on the left, the two big actions on the right.
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 14)
	box.add_child(footer)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.label_settings = MenuStyle.heading(20, Color.WHITE, 6)
	footer.add_child(_status)
	_ready_button = _button(footer, "Ready", _on_ready_pressed)
	_ready_button.custom_minimum_size = Vector2(200, 0)
	_start_button = _button(footer, "Start match", _on_start_pressed)
	_start_button.custom_minimum_size = Vector2(240, 0)
	MenuStyle.paint(_start_button, MenuStyle.ORANGE, 28)


func _refresh() -> void:
	if not Net.lobby.is_active():
		return
	var lobby := Net.lobby
	_code_label.text = "Practice" if _practice else "Room " + lobby.code()
	_phase_label.text = "Set up your practice range" if _practice else _phase_text(lobby.phase())
	_rebuild_members()
	_rebuild_teams()
	_refresh_setup()

	var is_ready := bool(lobby.me().get("ready", false))
	_ready_button.text = "Not ready" if is_ready else "Ready"
	MenuStyle.paint(_ready_button, MenuStyle.CREAM if is_ready else MenuStyle.GREEN, 28)

	var team_count := lobby.teams().size()
	var host := lobby.is_host()
	_add_button.visible = host
	_remove_button.visible = host
	_start_button.visible = host
	_add_button.disabled = team_count >= Proto.MAX_TEAMS
	_remove_button.disabled = team_count <= Proto.MIN_TEAMS
	_start_button.disabled = not lobby.can_start()
	if _practice:
		_start_button.disabled = lobby.my_team_id() == "" or lobby.phase() != "lobby"
		return
	if lobby.phase() == "lobby":
		if host:
			_status.text = "" if lobby.can_start() else "Everyone needs a team and to press Ready."
		else:
			_status.text = "Waiting for the host to start." if is_ready else "Take a seat on a team, then press Ready."


## One labelled drop-down in the Match card. Picking an entry sends that setting to the server.
func _setting(grid: GridContainer, title: String, key: String) -> OptionButton:
	var label := Label.new()
	label.text = title
	grid.add_child(label)
	var pick := OptionButton.new()
	pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	# Compact rows, so the whole lobby fits a 720p window.
	pick.add_theme_font_size_override("font_size", 18)
	for state in ["normal", "hover", "pressed", "disabled"]:
		var tint := MenuStyle.CREAM.lightened(0.18) if state == "hover" else MenuStyle.CREAM
		pick.add_theme_stylebox_override(state, MenuStyle.box(tint, 12, 3, 5, 2))
	pick.item_selected.connect(
		func(index: int) -> void:
			if _practice and key == "turnSeconds":
				# Practice turns are not a room setting; they ride along with the start request.
				_practice_turn = int(pick.get_item_metadata(index))
			else:
				Net.set_settings({key: pick.get_item_metadata(index)})
			if _practice:
				_remember_practice()
	)
	grid.add_child(pick)
	return pick


## Fill a drop-down with "Random" and then the ids the server offers, shown capitalised. An older
## server offers none, and the row stays empty and disabled.
func _fill_choices(pick: OptionButton, ids: Array) -> void:
	if ids.is_empty():
		pick.clear()
		return
	if pick.item_count == ids.size() + 1:
		return
	pick.clear()
	pick.add_item("Random")
	pick.set_item_metadata(0, "random")
	for id in ids:
		pick.add_item(str(id).capitalize())
		pick.set_item_metadata(pick.item_count - 1, str(id))


## Fill the map drop-downs from what the server offers, and show the current choices. Only the
## host can change them.
func _refresh_setup() -> void:
	var lobby := Net.lobby
	var options := lobby.map_options()
	var themes: Array = options.get("themes", [])
	var sizes: Array = options.get("sizes", [])
	if _theme_pick.item_count != themes.size() + 1:
		_theme_pick.clear()
		_theme_pick.add_item("Random")
		_theme_pick.set_item_metadata(0, "random")
		for t: Dictionary in themes:
			_theme_pick.add_item(str(t.get("name", t.get("id", "?"))))
			_theme_pick.set_item_metadata(_theme_pick.item_count - 1, str(t.get("id", "")))
	_fill_choices(_weather_pick, options.get("weathers", []))
	_fill_choices(_time_pick, options.get("times", []))
	if _size_pick.item_count != sizes.size():
		_size_pick.clear()
		for i in range(sizes.size()):
			var edge := int(sizes[i])
			var word: String = SIZE_WORDS[i] if i < SIZE_WORDS.size() else str(edge)
			_size_pick.add_item(word)
			_size_pick.set_item_metadata(i, edge)
	var current := lobby.settings()
	var can_edit := lobby.is_host() and lobby.phase() == "lobby"
	for pair in [[_theme_pick, "mapTheme"], [_size_pick, "mapSize"], [_weather_pick, "weather"], [_time_pick, "timeOfDay"], [_turn_pick, "turnSeconds"], [_count_pick, "crittersPerTeam"]]:
		var pick: OptionButton = pair[0]
		pick.disabled = not can_edit
		var want: Variant = current.get(pair[1], null)
		if _practice and pair[1] == "turnSeconds":
			want = _practice_turn
		for i in range(pick.item_count):
			var have: Variant = pick.get_item_metadata(i)
			# Numbers arrive from JSON as floats; compare as text for ids and as numbers otherwise.
			var same: bool = str(have) == str(want) if have is String else (want != null and int(have) == int(want))
			if same:
				pick.select(i)
				break


func _phase_text(phase: String) -> String:
	match phase:
		"lobby":
			return "Waiting in the lobby"
		"loading", "match":
			return "The match is starting"
		"results":
			return "Match over"
	return phase


func _rebuild_members() -> void:
	_clear(_members_box)
	var lobby := Net.lobby
	for raw in lobby.members():
		var m: Dictionary = raw
		var member_id := str(m.get("id", ""))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var dot := ColorRect.new()
		dot.custom_minimum_size = Vector2(14, 14)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		dot.color = MenuStyle.GREY
		if m.get("teamId") != null:
			dot.color = Color.html(str(lobby.team(str(m["teamId"])).get("hatColor", "#b9ad9c")))
		row.add_child(dot)
		var label := Label.new()
		label.text = str(m.get("nickname", ""))
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.clip_text = true
		row.add_child(label)
		if member_id == Net.my_id:
			row.add_child(MenuStyle.chip("YOU", MenuStyle.PAPER))
		if member_id == lobby.host_id():
			row.add_child(MenuStyle.chip("HOST", Color("ffd23f")))
		if bool(m.get("ready", false)):
			row.add_child(MenuStyle.chip("READY", MenuStyle.GREEN))
		elif m.get("teamId") == null:
			row.add_child(MenuStyle.chip("NO TEAM", MenuStyle.GREY))
		_members_box.add_child(row)


func _rebuild_teams() -> void:
	_clear(_teams_box)
	var lobby := Net.lobby
	var mine := lobby.my_team_id()
	for raw in lobby.teams():
		var t: Dictionary = raw
		var team_id := str(t.get("id", ""))
		var color := Color.html(str(t.get("hatColor", "#ffffff")))
		var panel := PanelContainer.new()
		var sb := MenuStyle.box(color.lerp(Color.WHITE, 0.55), 14, 3, 6, 0)
		panel.add_theme_stylebox_override("panel", sb)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		panel.add_child(row)

		var swatch := Panel.new()
		var dot := StyleBoxFlat.new()
		dot.bg_color = color
		dot.set_corner_radius_all(16)
		dot.set_border_width_all(3)
		dot.border_color = MenuStyle.INK
		swatch.add_theme_stylebox_override("panel", dot)
		swatch.custom_minimum_size = Vector2(32, 32)
		swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(swatch)

		var controller := lobby.controller_name(t)
		var name_label := Label.new()
		name_label.text = str(t.get("name", "Team"))
		name_label.add_theme_font_size_override("font_size", 22)
		row.add_child(name_label)
		var who := Label.new()
		who.text = controller if controller != "" else "open seat"
		who.modulate = Color(1, 1, 1, 1.0 if controller != "" else 0.55)
		who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		who.clip_text = true
		row.add_child(who)

		var seat := Button.new()
		seat.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		if team_id == mine:
			seat.text = "Leave seat"
			seat.pressed.connect(_on_set_team.bind(""))
			row.add_child(seat)
		elif controller == "":
			seat.text = "Take seat"
			seat.disabled = mine != ""
			MenuStyle.paint(seat, MenuStyle.BLUE)
			seat.pressed.connect(_on_set_team.bind(team_id))
			row.add_child(seat)
		_teams_box.add_child(panel)


func _clear(box: Node) -> void:
	for child in box.get_children():
		box.remove_child(child)
		child.queue_free()


func _heading(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", 22)
	return label


func _button(parent: Node, text: String, handler: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(handler)
	parent.add_child(b)
	return b


func _on_set_team(team_id: String) -> void:
	Net.set_team(team_id)


func _on_ready_pressed() -> void:
	Net.set_ready(not bool(Net.lobby.me().get("ready", false)))


func _on_add_pressed() -> void:
	Net.add_team()


func _on_remove_pressed() -> void:
	var teams := Net.lobby.teams()
	if teams.is_empty():
		return
	var last: Dictionary = teams.back()
	Net.remove_team(str(last.get("id", "")))


func _on_start_pressed() -> void:
	if _practice:
		start_practice_now()
		return
	# A fresh map every match: roll a new seed just before starting.
	Net.set_settings({"mapSeed": randi()})
	Net.start_match()


## Practice: roll a fresh map seed, then start against the target dummies.
func start_practice_now() -> void:
	_remember_practice()
	_status.text = "Starting practice."
	_start_button.disabled = true
	Net.set_settings({"mapSeed": randi()})
	Net.start_practice(_practice_turn)


func _on_copy_pressed() -> void:
	DisplayServer.clipboard_set(Net.lobby.code())
	_status.text = "Room code copied."


func _on_leave_pressed() -> void:
	Net.leave_room()


func _on_back_to_title(_reason: String) -> void:
	get_tree().change_scene_to_file.call_deferred(TITLE_SCENE)


func _on_disconnected(reason: String) -> void:
	get_tree().change_scene_to_file.call_deferred(TITLE_SCENE)
	push_warning("Disconnected from the server: " + reason)


func _on_server_error(code: String, message: String) -> void:
	_status.text = "%s (%s)" % [message, code]


func _on_match_started(_msg: Dictionary) -> void:
	# The match scene reads Net.current_match_start() when it loads. Until it exists in this build,
	# stay in the lobby and say so.
	if ResourceLoader.exists(MATCH_SCENE):
		get_tree().change_scene_to_file.call_deferred(MATCH_SCENE)
	else:
		_status.text = "The match started on the server, but the match scene is not in this build yet."
