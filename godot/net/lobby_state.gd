## Lobby data from the server's RoomState. No networking, so it is easy to test.
class_name LobbyState
extends RefCounted

var room: Dictionary = {}
## Set by the net layer once welcome arrives. Needed to find "me" in the member list.
var my_id: String = ""


func apply_room(new_room: Dictionary) -> void:
	room = new_room


func clear() -> void:
	room = {}


func is_active() -> bool:
	return not room.is_empty()


func code() -> String:
	return str(room.get("code", ""))


func phase() -> String:
	return str(room.get("phase", ""))


func host_id() -> String:
	return str(room.get("hostId", ""))


func members() -> Array:
	return room.get("members", [])


func teams() -> Array:
	return room.get("teams", [])


func member(id: String) -> Dictionary:
	for raw in members():
		var m: Dictionary = raw
		if str(m.get("id", "")) == id:
			return m
	return {}


func me() -> Dictionary:
	return member(my_id)


func is_host() -> bool:
	return my_id != "" and my_id == host_id()


## Team id of this player's seat, or "" when they have not taken one.
func my_team_id() -> String:
	var m := me()
	if m.is_empty() or m.get("teamId") == null:
		return ""
	return str(m["teamId"])


func team(id: String) -> Dictionary:
	for raw in teams():
		var t: Dictionary = raw
		if str(t.get("id", "")) == id:
			return t
	return {}


## Nickname of the player sitting in this team's seat, or "" when the seat is free.
func controller_name(team_dict: Dictionary) -> String:
	var ctrl = team_dict.get("controllerId")
	if ctrl == null:
		return ""
	return str(member(str(ctrl)).get("nickname", ""))


## Same rule as the server's lobby.start: at least 2 teams with a seated player, every member on a
## team, ready and connected, in the lobby phase.
func can_start() -> bool:
	if not is_active() or phase() != "lobby":
		return false
	var seated := 0
	for raw in teams():
		var t: Dictionary = raw
		if t.get("controllerId") != null:
			seated += 1
	if seated < Proto.MIN_TEAMS:
		return false
	for raw in members():
		var m: Dictionary = raw
		if m.get("teamId") == null or not bool(m.get("ready", false)) or not bool(m.get("connected", false)):
			return false
	return true
