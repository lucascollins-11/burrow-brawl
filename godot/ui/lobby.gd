## Lobby: room code, players, the team list (up to 8 seats), ready, add or remove teams, start.
extends Control

const TITLE_SCENE := "res://ui/title.tscn"

var _code_label: Label
var _phase_label: Label
var _members_box: VBoxContainer
var _teams_box: VBoxContainer
var _ready_button: Button
var _add_button: Button
var _remove_button: Button
var _start_button: Button
var _status: Label


func _ready() -> void:
	if not Net.lobby.is_active():
		get_tree().change_scene_to_file.call_deferred(TITLE_SCENE)
		return
	_build()
	Net.room_changed.connect(_refresh)
	Net.room_left.connect(_on_back_to_title)
	Net.disconnected.connect(_on_disconnected)
	Net.server_error.connect(_on_server_error)
	Net.match_started.connect(_on_match_started)
	_refresh()


func _build() -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["margin_left", "margin_top", "margin_right", "margin_bottom"]:
		margin.add_theme_constant_override(side, 24)
	add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)

	_code_label = Label.new()
	_code_label.add_theme_font_size_override("font_size", 36)
	box.add_child(_code_label)
	_phase_label = Label.new()
	box.add_child(_phase_label)

	box.add_child(_heading("Players"))
	_members_box = VBoxContainer.new()
	box.add_child(_members_box)

	box.add_child(_heading("Teams (up to %d)" % Proto.MAX_TEAMS))
	_teams_box = VBoxContainer.new()
	box.add_child(_teams_box)

	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 8)
	box.add_child(controls)
	_ready_button = _button(controls, "Ready", _on_ready_pressed)
	_add_button = _button(controls, "Add team", _on_add_pressed)
	_remove_button = _button(controls, "Remove last team", _on_remove_pressed)
	_start_button = _button(controls, "Start match", _on_start_pressed)

	var leave_row := HBoxContainer.new()
	box.add_child(leave_row)
	_button(leave_row, "Leave room", _on_leave_pressed)

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_status)


func _refresh() -> void:
	if not Net.lobby.is_active():
		return
	var lobby := Net.lobby
	_code_label.text = "Room " + lobby.code()
	_phase_label.text = _phase_text(lobby.phase())
	_rebuild_members()
	_rebuild_teams()

	var is_ready := bool(lobby.me().get("ready", false))
	_ready_button.text = "Not ready" if is_ready else "Ready"

	var team_count := lobby.teams().size()
	var host := lobby.is_host()
	_add_button.visible = host
	_remove_button.visible = host
	_start_button.visible = host
	_add_button.disabled = team_count >= Proto.MAX_TEAMS
	_remove_button.disabled = team_count <= Proto.MIN_TEAMS
	_start_button.disabled = not lobby.can_start()


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
		var tags := PackedStringArray()
		if member_id == lobby.host_id():
			tags.append("host")
		if bool(m.get("ready", false)):
			tags.append("ready")
		if member_id == Net.my_id:
			tags.append("you")
		var seat := "no team"
		if m.get("teamId") != null:
			seat = str(lobby.team(str(m["teamId"])).get("name", "?"))
		var label := Label.new()
		label.text = "%s  [%s]  %s" % [str(m.get("nickname", "")), ", ".join(tags), seat]
		_members_box.add_child(label)


func _rebuild_teams() -> void:
	_clear(_teams_box)
	var lobby := Net.lobby
	var mine := lobby.my_team_id()
	for raw in lobby.teams():
		var t: Dictionary = raw
		var team_id := str(t.get("id", ""))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)

		var swatch := ColorRect.new()
		swatch.color = Color.html(str(t.get("hatColor", "#ffffff")))
		swatch.custom_minimum_size = Vector2(24, 24)
		row.add_child(swatch)

		var controller := lobby.controller_name(t)
		var name_label := Label.new()
		name_label.text = str(t.get("name", "Team"))
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name_label)

		var seat := Button.new()
		if team_id == mine:
			seat.text = "Leave seat"
			seat.pressed.connect(_on_set_team.bind(""))
		elif controller == "":
			seat.text = "Take seat"
			seat.disabled = mine != ""
			seat.pressed.connect(_on_set_team.bind(team_id))
		else:
			seat.text = controller
			seat.disabled = true
		row.add_child(seat)

		_teams_box.add_child(row)


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
	Net.start_match()


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
	_status.text = "The match started on the server. The match view arrives in G1."
