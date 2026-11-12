## Network autoload (name: Net). Guest login, the WebSocket to the game server, and the room the
## player is in. Screens use the action methods and listen to the signals; they never touch sockets.
## Wire contract: docs/protocol.md (lobby) and docs/view-protocol.md (match, view client).
extends Node

signal entered_room
signal enter_failed(message: String)
signal room_changed
signal room_left(reason: String)
signal disconnected(reason: String)
signal reconnecting(attempt: int)
signal chat_received(from_name: String, text: String)
signal server_error(code: String, message: String)

## View protocol. Payloads are passed through unchanged; the match scenes decode them.
signal match_started(msg: Dictionary)
signal view_state(msg: Dictionary)
signal view_events(msg: Dictionary)
signal terrain_patch(msg: Dictionary)
signal match_ended(msg: Dictionary)

const PING_INTERVAL := 2.0
## Free hosts can take about a minute to wake from sleep.
const GUEST_TIMEOUT := 90.0
const RECONNECT_DELAY := 2.0
const RECONNECT_ATTEMPTS := 5
## Inbound frames can be big: a view match.start is about 0.5 MB on 2 teams and 2 MB on 8. The
## default inbound buffer (64 KiB) would drop them.
const INBOUND_BUFFER_BYTES := 8 * 1024 * 1024

var lobby := LobbyState.new()
var nickname: String = ""
var my_id: String = ""
var token: String = ""
## True once welcome has arrived on the current socket.
var connected: bool = false

## Last match.start payload, kept so a scene that loads late (or after a reconnect) can start from it.
var _match_start: Dictionary = {}
## Resume token from welcome. Sent in the next hello so the seat comes back after a reconnect.
var _resume_token := ""
## Code of the room we are in (set on room.joined). Used to rejoin after a dropped connection.
var _room_code := ""
## Seconds until the next reconnect attempt, or a negative number when none is scheduled.
var _reconnect_wait := -1.0
var _reconnect_attempt := 0

var _http: HTTPRequest
var _socket := WebSocketPeer.new()
var _socket_started := false
var _hello_sent := false
var _seq := 0
var _ping_timer := 0.0
var _pending_mode := ""  # "create", "join", "rejoin" or "resync" while a room request is in flight
var _pending_code := ""
var _pending_seq := -1
var _token_nick := ""  # nickname the cached token was issued for
var _http_busy := false


func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = GUEST_TIMEOUT
	_http.request_completed.connect(_on_guest_response)
	add_child(_http)


## Enter a room. mode is "create" or "join" (join also needs a code). Results come back as
## entered_room or enter_failed.
func enter_room(mode: String, nick: String, code: String = "") -> void:
	if _pending_mode != "" or _http_busy:
		return
	var clean_code := ""
	if mode == "join":
		clean_code = Proto.normalize_code(code)
		if clean_code == "":
			enter_failed.emit("That room code is not valid.")
			return
	nickname = nick
	_pending_mode = mode
	_pending_code = clean_code
	if token != "" and _token_nick == nick:
		_open_socket()
	else:
		_request_guest(nick)


func leave_room() -> void:
	_send("room.leave")


func set_team(team_id: String) -> void:
	# An empty id releases the seat.
	var value: Variant = null if team_id == "" else team_id
	_send("lobby.setTeam", {"teamId": value})


func set_ready(ready: bool) -> void:
	_send("lobby.ready", {"ready": ready})


## Host only: change some match settings. The server answers with a new room state.
func set_settings(patch: Dictionary) -> void:
	_send("lobby.setSettings", {"patch": patch})


func add_team() -> void:
	_send("lobby.addTeam")


func remove_team(team_id: String) -> void:
	_send("lobby.removeTeam", {"teamId": team_id})


func start_match() -> void:
	_send("lobby.start")


## Last match.start received in this room, or {} when there is no match. Survives a reconnect
## (the server sends match.start again), and is cleared when the room is left or the match ends.
func current_match_start() -> Dictionary:
	return _match_start


## Send the active player's commands for one turn: {turn, cmds} as in docs/view-protocol.md section 6.
func send_input(turn: int, cmds: Array) -> int:
	return _send("input", {"turn": turn, "cmds": cmds})


func _request_guest(nick: String) -> void:
	var urls := NetConfig.urls(NetConfig.server_base())
	if not urls.has("http"):
		_fail("The server address is not valid.")
		return
	var body := JSON.stringify({"nickname": nick})
	var err := _http.request(
		str(urls["http"]) + "/api/guest",
		PackedStringArray(["Content-Type: application/json"]),
		HTTPClient.METHOD_POST,
		body,
	)
	if err != OK:
		_fail("Could not reach the server.")
		return
	_http_busy = true


func _on_guest_response(
	result: int, code: int, _headers: PackedStringArray, body: PackedByteArray
) -> void:
	_http_busy = false
	if result != HTTPRequest.RESULT_SUCCESS:
		_fail("The server did not answer. It may be waking up; try again in a minute.")
		return
	if code < 200 or code >= 300:
		if code >= 400 and code < 500:
			_fail("The server refused that nickname (HTTP %d)." % code)
		else:
			_fail("The server is waking up or unreachable (HTTP %d). Try again in a minute." % code)
		return
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY or not parsed.has("token"):
		_fail("The server sent an unexpected reply.")
		return
	var data: Dictionary = parsed
	token = str(data["token"])
	_token_nick = nickname
	_open_socket()


func _open_socket() -> void:
	if connected:
		_send_pending()
		return
	if _socket_started:
		return  # already connecting; the pending request goes out on welcome
	var urls := NetConfig.urls(NetConfig.server_base())
	if not urls.has("ws"):
		_connection_failed("The server address is not valid.")
		return
	_socket = WebSocketPeer.new()
	_socket.inbound_buffer_size = INBOUND_BUFFER_BYTES
	if _socket.connect_to_url(str(urls["ws"])) != OK:
		_connection_failed("Could not open a connection to the server.")
		return
	_socket_started = true
	_hello_sent = false


func _process(delta: float) -> void:
	if _reconnect_wait >= 0.0 and not _socket_started:
		_reconnect_wait -= delta
		if _reconnect_wait < 0.0:
			_reconnect_wait = -1.0
			_open_socket()
		return
	if not _socket_started:
		return
	_socket.poll()
	var state := _socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _hello_sent:
			_hello_sent = true
			_socket.send_text(
				Proto.encode("hello", Proto.hello_fields(token, _resume_token))
			)
		while _socket.get_available_packet_count() > 0:
			_on_frame(_socket.get_packet().get_string_from_utf8())
		_ping_timer += delta
		if _ping_timer >= PING_INTERVAL and connected:
			_ping_timer = 0.0
			_send("ping", {"clientTime": Time.get_ticks_msec()})
	elif state == WebSocketPeer.STATE_CLOSED:
		_on_socket_closed()


func _on_socket_closed() -> void:
	var was_connected := connected
	var code := _socket.get_close_code()
	var reason := _socket.get_close_reason()
	_socket_started = false
	_hello_sent = false
	connected = false
	var detail := reason if reason != "" else "closed (%d)" % code
	if _room_code != "":
		# In a room: keep the seat by reconnecting and rejoining, instead of dropping to the title.
		_pending_mode = ""
		_pending_seq = -1
		_schedule_reconnect(detail)
		return
	if _pending_mode != "":
		_fail("Lost the connection to the server.")
	elif was_connected:
		lobby.clear()
		_match_start = {}
		disconnected.emit(detail)


## Wait a moment, then open the socket again. Gives up after RECONNECT_ATTEMPTS tries.
func _schedule_reconnect(why: String) -> void:
	_reconnect_attempt += 1
	if _reconnect_attempt > RECONNECT_ATTEMPTS:
		_give_up(why)
		return
	_reconnect_wait = RECONNECT_DELAY
	reconnecting.emit(_reconnect_attempt)


func _give_up(why: String) -> void:
	if _socket_started:
		_socket.close()
	_socket_started = false
	_hello_sent = false
	connected = false
	_reconnect_attempt = 0
	_reconnect_wait = -1.0
	_pending_mode = ""
	_pending_seq = -1
	_room_code = ""
	lobby.clear()
	_match_start = {}
	disconnected.emit(why)


func _connection_failed(message: String) -> void:
	if _room_code != "":
		_schedule_reconnect(message)
	else:
		_fail(message)


func _on_frame(text: String) -> void:
	var msg := Proto.decode(text)
	if msg.is_empty():
		return
	match str(msg["t"]):
		"welcome":
			var you: Dictionary = msg.get("you", {})
			my_id = str(you.get("id", ""))
			_resume_token = str(msg.get("resumeToken", _resume_token))
			connected = true
			if _room_code != "" and _reconnect_attempt > 0:
				# The hello carried the resume token, so the seat should be back. Ask for the room
				# state only. A room.join here would make the server send a second match.start.
				_pending_mode = "resync"
				_send_pending()
			elif _pending_mode != "":
				_send_pending()
		"room.joined":
			_apply_room(msg)
			if _pending_mode != "" and _is_reply_to_pending(msg):
				var was_rejoin := _pending_mode == "rejoin"
				_pending_mode = ""
				_pending_seq = -1
				_reconnect_attempt = 0
				if was_rejoin:
					room_changed.emit()
				else:
					entered_room.emit()
			else:
				room_changed.emit()
		"room.update":
			_apply_room(msg)
			if _pending_mode == "resync":
				_pending_mode = ""
				_pending_seq = -1
				_reconnect_attempt = 0
			room_changed.emit()
		"room.left":
			lobby.clear()
			_room_code = ""
			_match_start = {}
			room_left.emit(str(msg.get("reason", "left")))
		"chat":
			chat_received.emit(str(msg.get("from", "")), str(msg.get("text", "")))
		"error":
			var code := str(msg.get("code", "internal"))
			var message := str(msg.get("message", ""))
			var is_reply := not msg.has("re") or _is_reply_to_pending(msg)
			if _pending_mode == "resync" and is_reply:
				# The seat did not come back with the resume token: join by code instead.
				_pending_mode = "rejoin"
				_send_pending()
			elif _pending_mode == "rejoin" and is_reply:
				_pending_mode = ""
				_pending_seq = -1
				_give_up("Could not get back into the room: " + message)
			elif _pending_mode != "" and is_reply:
				_fail(message)
			else:
				server_error.emit(code, message)
		"match.start":
			_match_start = msg.duplicate()
			match_started.emit(msg)
		"state":
			view_state.emit(msg)
		"events":
			view_events.emit(msg)
		"terrain.patch":
			terrain_patch.emit(msg)
		"match.end":
			match_ended.emit(msg)
			_match_start = {}
		_:
			pass  # ok, pong and anything unknown


func _apply_room(msg: Dictionary) -> void:
	var room: Dictionary = msg.get("room", {})
	lobby.my_id = my_id
	lobby.apply_room(room)
	if lobby.code() != "":
		_room_code = lobby.code()


func _is_reply_to_pending(msg: Dictionary) -> bool:
	return _pending_seq >= 0 and int(msg.get("re", -1)) == _pending_seq


func _send_pending() -> void:
	if _pending_mode == "create":
		_pending_seq = _send("room.create")
	elif _pending_mode == "join":
		_pending_seq = _send("room.join", {"code": _pending_code})
	elif _pending_mode == "rejoin":
		_pending_seq = _send("room.join", {"code": _room_code})
	elif _pending_mode == "resync":
		_pending_seq = _send("room.sync")


func _fail(message: String) -> void:
	_pending_mode = ""
	_pending_code = ""
	_pending_seq = -1
	enter_failed.emit(message)


## Send a request with a seq so its reply can be matched. Returns the seq, or -1 when not connected.
func _send(msg_type: String, fields: Dictionary = {}) -> int:
	if not connected:
		server_error.emit("internal", "Not connected to the server.")
		return -1
	_seq += 1
	var payload: Dictionary = fields.duplicate()
	payload["seq"] = _seq
	_socket.send_text(Proto.encode(msg_type, payload))
	return _seq
