class_name MatchScene
extends Node3D
## The match view: draws the server's state and sends the player's input (port of
## client/src/game3d/game3d.ts). The Node server is the only referee. This scene never computes
## physics, damage or terrain edits.
##
## Messages come from the Net autoload (match_started, view_state, view_events, terrain_patch,
## match_ended) or from tests that call the handle_* methods directly. Outgoing input is the
## `input_ready` signal, and also Net.send_input(turn, cmds) when Net has it.
##
## Terrain is optional and duck-typed so godot/terrain can plug in without this scene knowing its
## class: put a Node3D with the script res://terrain/terrain_view.gd (or call set_terrain_view)
## that offers load_terrain(dict), apply_patch(msg) and ground_y(x, z) -> float. Without it the
## scene shows no ground (the sea and critters still draw), which is enough for the first CI build.

signal input_ready(msg: Dictionary)
signal left_match

## The character model. To swap the character, point this at another script with the same static API
## (HEIGHT, create(team, hat_style, color), animate(root, t, active, moving), set_tag(root, text, color)).
const CRITTER_MODEL := preload("res://game/squirmling.gd")
const TERRAIN_SCRIPT := "res://terrain/terrain_view.gd"
const LOBBY_SCENE := "res://ui/lobby.tscn"
const TITLE_SCENE := "res://ui/title.tscn"
const BLAST_HOLD_S := 1.4
const HINT_WATCH := "Watching. Hold tight."

var vm := ViewModel.new()
var controls := Controls.new()
var hud: Hud
var camera: Camera3D
var env: MatchEnvironment
var fx: MatchEffects
var shots: ShotViews
var pause: PauseMenu
var terrain_view: Node3D = null

var _critters: Dictionary = {}  # id -> Node3D
var _rig := CameraMath.RigState.new()
var _blast_at := Vector3.ZERO
var _blast_left := 0.0
var _marker: MeshInstance3D
var _time := 0.0
var _last_turn := -1
var _last_tick_second := -1
var _prev_pos: Dictionary = {}  # id -> Vector3, to tell walking from standing
var _built := false
var _world := Vector2(256, 256)


func _ready() -> void:
	name = "MatchScene"
	camera = Camera3D.new()
	camera.name = "Camera"
	camera.fov = 60.0
	camera.near = 0.3
	camera.far = 3000.0
	camera.current = true
	add_child(camera)
	env = MatchEnvironment.new()
	env.name = "Environment"
	add_child(env)
	fx = MatchEffects.new()
	fx.name = "Effects"
	add_child(fx)
	shots = ShotViews.new()
	shots.name = "Shots"
	add_child(shots)
	controls.name = "Controls"
	add_child(controls)
	hud = Hud.new()
	hud.name = "Hud"
	add_child(hud)
	pause = PauseMenu.new()
	pause.name = "Pause"
	add_child(pause)
	pause.leave_pressed.connect(_leave)
	hud.skip_pressed.connect(controls.skip)
	hud.leave_pressed.connect(_leave)
	hud.again_pressed.connect(_back_to_lobby)
	if hud.has_signal("weapon_picked"):
		hud.connect("weapon_picked", func(i: int) -> void: controls.weapon = i)
	_make_marker()
	_connect_net()


func _connect_net() -> void:
	var net := get_node_or_null("/root/Net")
	if net == null:
		return
	net.match_started.connect(handle_match_start)
	net.view_state.connect(handle_state)
	net.view_events.connect(handle_events)
	net.terrain_patch.connect(handle_terrain_patch)
	net.match_ended.connect(handle_match_end)
	net.room_left.connect(_on_room_left)
	net.disconnected.connect(_on_disconnected)
	# The lobby switches scenes when match.start arrives, so pick up the one it kept for us.
	if net.has_method("current_match_start"):
		var kept: Dictionary = net.call("current_match_start")
		if not kept.is_empty():
			handle_match_start(kept)


## Let a terrain node (godot/terrain) take part. See the header for the three methods it offers.
func set_terrain_view(node: Node3D) -> void:
	if terrain_view != null:
		terrain_view.queue_free()
	terrain_view = node
	terrain_view.name = "Terrain"
	add_child(terrain_view)


func handle_match_start(msg: Dictionary) -> void:
	_clear_critters()
	shots.clear()
	vm.set_teams(_teams_from_net(msg.get("teamIds", [])))
	vm.set_local_teams(_local_teams_from_net(msg.get("teamIds", [])))
	vm.apply_match_start(msg)
	var t: Dictionary = msg.get("terrain", {})
	_world = Vector2(float(t.get("sizeX", 256)), float(t.get("sizeZ", 256)))
	if terrain_view == null and ResourceLoader.exists(TERRAIN_SCRIPT):
		var script: Script = load(TERRAIN_SCRIPT)
		var node := Node3D.new()
		node.set_script(script)
		set_terrain_view(node)
	if terrain_view != null and terrain_view.has_method("load_terrain"):
		terrain_view.call("load_terrain", t)
	env.setup(_world.x, _world.y, vm.sea_y, Callable(self, "ground_y"))
	var world_env := env.get("_world_env") as WorldEnvironment
	if world_env != null and world_env.environment != null:
		world_env.environment.glow_enabled = GameSettings.glow_enabled()
	_rig.target = Vector3(_world.x * 0.5, vm.sea_y + 25.0, _world.y * 0.5)
	_rig.dist = 90.0
	_built = true
	_last_turn = -1
	_last_tick_second = -1
	Audio.preload_all()
	Audio.play_music("match")


func handle_state(msg: Dictionary) -> void:
	vm.apply_state(msg)


func handle_events(msg: Dictionary) -> void:
	vm.apply_events(msg)


func handle_terrain_patch(msg: Dictionary) -> void:
	if terrain_view != null and terrain_view.has_method("apply_patch"):
		terrain_view.call("apply_patch", msg)


func handle_match_end(_msg: Dictionary) -> void:
	pass  # the final state carries phase "over" and winnerTeam, which the HUD shows


func ground_y(x: float, z: float) -> float:
	if terrain_view != null and terrain_view.has_method("ground_y"):
		return float(terrain_view.call("ground_y", x, z))
	return vm.sea_y + 10.0


func _unhandled_input(ev: InputEvent) -> void:
	if ev.is_action_pressed("pause") and controls.aim == null:
		pause.toggle()
		return
	if not pause.is_open():
		controls.handle_event(ev)


## "Walk" and "aim" hints use whatever keys the player has bound.
func _hint_walk() -> String:
	return "%s walk - %s jump - %s backflip - %s aim - %s skip" % [
		"WASD", _key("jump"), _key("backflip"), _key("toggle_aim"), _key("skip")
	]


func _hint_aim() -> String:
	return "Move the mouse to aim - hold %s to charge - release to fire - %s cancel" % [_key("fire"), _key("cancel_aim")]


func _key(action: String) -> String:
	return GameSettings.key_label(int(GameSettings.keys.get(action, 0)))


func _process(dt: float) -> void:
	if not _built:
		return
	_time += dt
	vm.advance(dt)
	var v := vm.snapshot()

	controls.enabled = bool(v["my_turn"]) and v["phase"] != "over"
	controls.can_fire = controls.enabled and v["phase"] == "control"
	if int(v["turn"]) != _last_turn:
		_last_turn = int(v["turn"])
		controls.new_turn()
		if v["phase"] != "over":
			Audio.on_turn_start()
	var secs := int(ceil(float(v["time_left"])))
	if secs != _last_tick_second:
		_last_tick_second = secs
		if v["phase"] == "control":
			Audio.on_timer(float(secs))
	controls.camera_yaw_deg = _rig.yaw_deg
	var active := _find(v["critters"], v["active_critter_id"])
	if not active.is_empty():
		controls.heading_deg = float(active["heading_deg"])
	var mouse := controls.frame(dt)
	var cmds := controls.read_cmds()
	if not cmds.is_empty():
		_send_input(int(v["turn"]), cmds)
	var aim: CameraMath.AimState = controls.aim

	_handle_events(vm.take_events(), v)
	_sync_critters(v, active)
	shots.sync(v["projectiles"])
	_update_marker(v, active, aim)
	_update_camera(v, active, aim, mouse, dt)

	env.set_sea_y(vm.sea_y)
	env.update(dt, v["wind"])
	var hint := HINT_WATCH
	if v["my_turn"] and v["phase"] != "settling":
		hint = _hint_aim() if aim != null else _hint_walk()
	hud.update(v, aim, "" if v["phase"] == "over" else hint, controls.weapon_name(), _world)


func _send_input(turn: int, cmds: Array) -> void:
	var msg := {"turn": turn, "cmds": cmds}
	input_ready.emit(msg)
	var net := get_node_or_null("/root/Net")
	if net != null and net.has_method("send_input"):
		net.call("send_input", turn, cmds)


func _handle_events(events: Array, v: Dictionary) -> void:
	Audio.on_events(events)
	for e in events:
		var kind := str(e.get("type", ""))
		if kind == "explosion":
			var edit: Dictionary = e.get("edit", {})
			if str(edit.get("op", "")) != "box":
				var at := Vector3(
					float(edit.get("x", 0)) + 0.5, float(edit.get("y", 0)) + 0.5, float(edit.get("z", 0)) + 0.5
				)
				fx.explode(at, float(edit.get("r", 3)))
				_blast_at = at
				_blast_left = BLAST_HOLD_S
		elif kind == "damage":
			var c := _find(v["critters"], int(e.get("critterId", -1)))
			if not c.is_empty():
				fx.damage((c["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT, 0), int(e.get("amount", 0)))


func _sync_critters(v: Dictionary, active: Dictionary) -> void:
	var seen := {}
	for c in v["critters"]:
		var id: int = c["id"]
		seen[id] = true
		var node: Node3D = _critters.get(id, null)
		if node == null:
			var look: Dictionary = _look(int(c["team"]))
			node = CRITTER_MODEL.create(int(c["team"]), str(look["hat"]), look["color"])
			_critters[id] = node
			add_child(node)
		node.visible = c["alive"]
		var pos: Vector3 = c["pos"]
		var moving: bool = _prev_pos.has(id) and (_prev_pos[id] as Vector3).distance_squared_to(pos) > 0.0004
		_prev_pos[id] = pos
		node.position = pos
		node.rotation.y = deg_to_rad(float(c["heading_deg"]))
		var is_active: bool = not active.is_empty() and active["id"] == id
		CRITTER_MODEL.animate(node, _time + float(id) * 0.37, is_active, moving)
		var team_color: Color = _look(int(c["team"]))["color"]
		CRITTER_MODEL.set_tag(node, "%s  %d" % [c["name"], c["hp"]], team_color.lightened(0.45))
	for id in _critters.keys():
		if not seen.has(id):
			(_critters[id] as Node).queue_free()
			_critters.erase(id)
			_prev_pos.erase(id)


func _update_camera(v: Dictionary, active: Dictionary, aim: CameraMath.AimState, mouse: Dictionary, dt: float) -> void:
	if aim == null:
		_rig = CameraMath.drag_orbit(_rig, float(mouse["dx"]), float(mouse["dy"]))
	_rig = CameraMath.zoom(_rig, float(mouse["wheel"]))
	_blast_left = maxf(0.0, _blast_left - dt)
	var goal: Dictionary
	var shot_list: Array = v["projectiles"]
	if not shot_list.is_empty():
		goal = {"mode": "follow", "target": shot_list[0]["pos"], "dist": 38.0}
	elif _blast_left > 0.0:
		goal = {"mode": "follow", "target": _blast_at, "dist": 42.0}
	elif aim != null and not active.is_empty():
		var d := CameraMath.aim_direction(aim)
		var p: Vector3 = active["pos"]
		goal = {
			"mode": "aim",
			"target": p + Vector3(0, CRITTER_MODEL.HEIGHT * 0.8, 0) + d * 22.0,
			"yaw_deg": CameraMath.camera_yaw_for_heading(CameraMath.yaw_to_deg(aim.yaw)),
			"pitch_deg": -float(aim.pitch_deg),
			"dist": CameraMath.AIM_DIST + 22.0,
		}
	else:
		var tgt := _rig.target
		if not active.is_empty():
			tgt = (active["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT * 0.6, 0)
		goal = {
			"mode": "orbit",
			"target": tgt,
			"pitch_deg": clampf(_rig.pitch_deg, CameraMath.ORBIT_MIN_PITCH, CameraMath.ORBIT_MAX_PITCH),
			"dist": clampf(_rig.dist, CameraMath.ORBIT_MIN_DIST, CameraMath.ORBIT_MAX_DIST),
		}
	_rig = CameraMath.step_rig(_rig, goal, dt)
	var pos := CameraMath.rig_position(_rig)
	# Never let the camera sink under the ground or the soda.
	pos.y = maxf(pos.y, maxf(ground_y(pos.x, pos.z) + 2.5, float(v["sea_y"]) + 2.0))
	fx.update(dt)
	camera.position = pos + fx.shake_offset
	camera.look_at(_rig.target, Vector3.UP)


func _make_marker() -> void:
	_marker = MeshInstance3D.new()
	_marker.name = "ActiveMarker"
	var cone := CylinderMesh.new()
	cone.top_radius = 0.0
	cone.bottom_radius = 1.1
	cone.height = 1.8
	_marker.mesh = cone
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("ffd23f")
	mat.emission_enabled = true
	mat.emission = Color("ffb300")
	mat.emission_energy_multiplier = 0.8
	_marker.material_override = mat
	_marker.rotation.x = PI  # point down at the critter
	_marker.visible = false
	add_child(_marker)


func _update_marker(v: Dictionary, active: Dictionary, aim: CameraMath.AimState) -> void:
	_marker.visible = not active.is_empty() and v["phase"] == "control" and aim == null
	if _marker.visible:
		var p: Vector3 = active["pos"]
		_marker.position = p + Vector3(0, CRITTER_MODEL.HEIGHT + 3.5 + sin(_time * 4.0) * 0.4, 0)


func _look(team: int) -> Dictionary:
	if team >= 0 and team < vm.teams.size():
		return vm.teams[team]
	return TeamStyle.default_look(team)


## Team looks from the lobby (name, hat colour, hat style), in match team order.
func _teams_from_net(team_ids: Array) -> Array:
	var net := get_node_or_null("/root/Net")
	var out: Array = []
	for i in range(team_ids.size()):
		var look := TeamStyle.default_look(i)
		if net != null and net.get("lobby") != null:
			var t: Dictionary = net.lobby.team(str(team_ids[i]))
			if not t.is_empty():
				look["name"] = str(t.get("name", look["name"]))
				look["color"] = Color.html(str(t.get("hatColor", "#ffffff")))
				look["hat"] = str(t.get("hatStyle", look["hat"]))
		out.append(look)
	return out


func _local_teams_from_net(team_ids: Array) -> Array:
	var net := get_node_or_null("/root/Net")
	if net == null or net.get("lobby") == null:
		return range(team_ids.size())  # no lobby (tests, local view): every team is ours
	var mine: String = net.lobby.my_team_id()
	var idx := team_ids.find(mine)
	return [idx] if idx >= 0 else []


static func _find(list: Array, id: Variant) -> Dictionary:
	if id == null:
		return {}
	for c in list:
		if int(c["id"]) == int(id):
			return c
	return {}


func _clear_critters() -> void:
	for id in _critters.keys():
		(_critters[id] as Node).queue_free()
	_critters.clear()
	_prev_pos.clear()


func _back_to_lobby() -> void:
	var net := get_node_or_null("/root/Net")
	if net != null and net.get("lobby") != null and net.lobby.is_active():
		get_tree().change_scene_to_file.call_deferred(LOBBY_SCENE)
	else:
		_go_title()
	left_match.emit()


func _on_room_left(_reason: String) -> void:
	_go_title()


func _on_disconnected(_reason: String) -> void:
	_go_title()


func _go_title() -> void:
	if is_inside_tree():
		get_tree().change_scene_to_file.call_deferred(TITLE_SCENE)


func _leave() -> void:
	var net := get_node_or_null("/root/Net")
	if net != null and net.has_method("leave_room"):
		net.call("leave_room")
	left_match.emit()
