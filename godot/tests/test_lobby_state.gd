extends TestCase


func room(phase: String, members: Array, teams: Array) -> Dictionary:
	return {
		"code": "K7QX2",
		"phase": phase,
		"hostId": "h",
		"members": members,
		"teams": teams,
		"settings": {},
		"version": 1,
	}


func member(id: String, team_id: Variant, ready: bool) -> Dictionary:
	return {
		"id": id,
		"nickname": id.to_upper(),
		"teamId": team_id,
		"ready": ready,
		"connected": true,
		"pingMs": 0,
	}


func team(id: String, controller: Variant) -> Dictionary:
	return {
		"id": id,
		"name": "Team " + id,
		"hatColor": "#f28b82",
		"hatStyle": "miner",
		"critterNames": ["a"],
		"controllerId": controller,
	}


func test_can_start_needs_two_seated_ready_teams_in_the_lobby() -> void:
	var lobby := LobbyState.new()
	lobby.my_id = "h"
	lobby.apply_room(
		room("lobby", [member("h", "t1", true), member("g", "t2", true)], [team("t1", "h"), team("t2", "g")])
	)
	check(lobby.can_start(), "two ready, seated teams can start")

	lobby.apply_room(
		room("lobby", [member("h", "t1", true), member("g", null, true)], [team("t1", "h"), team("t2", null)])
	)
	check(not lobby.can_start(), "an unseated member blocks the start")

	lobby.apply_room(
		room("lobby", [member("h", "t1", true), member("g", "t2", false)], [team("t1", "h"), team("t2", "g")])
	)
	check(not lobby.can_start(), "an unready member blocks the start")

	lobby.apply_room(room("lobby", [member("h", "t1", true)], [team("t1", "h")]))
	check(not lobby.can_start(), "one team cannot start")

	lobby.apply_room(
		room("match", [member("h", "t1", true), member("g", "t2", true)], [team("t1", "h"), team("t2", "g")])
	)
	check(not lobby.can_start(), "a room that is not in the lobby cannot start")


func test_can_start_needs_every_member_connected() -> void:
	var lobby := LobbyState.new()
	lobby.my_id = "h"
	var g := member("g", "t2", true)
	g["connected"] = false
	lobby.apply_room(room("lobby", [member("h", "t1", true), g], [team("t1", "h"), team("t2", "g")]))
	check(not lobby.can_start(), "a disconnected member blocks the start")


func test_host_seat_and_controller_lookups() -> void:
	var lobby := LobbyState.new()
	lobby.my_id = "g"
	lobby.apply_room(
		room("lobby", [member("h", "t1", false), member("g", "t2", false)], [team("t1", "h"), team("t2", "g")])
	)
	check(not lobby.is_host(), "g is not the host")
	check_eq(lobby.my_team_id(), "t2", "my seat")
	check_eq(lobby.controller_name(lobby.team("t1")), "H", "controller nickname")
	check_eq(lobby.team("missing").is_empty(), true, "unknown team is empty")

	lobby.clear()
	check(not lobby.is_active(), "clear empties the room")
