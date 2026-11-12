## End-to-end check: two clients in one process play against a real game server.
##
## Client A is the Net autoload with the real MatchScene on top of it; client B is a second copy
## of the Net script. They create and join a room, start a match, A fires one shot, the island is
## carved on both, the turn passes, B skips. Exits 0 on success and 1 with a reason otherwise.
##
##   godot --headless --path godot res://tests/e2e/e2e_match.tscn -- --server=http://127.0.0.1:8080
##
## With a window (for example under xvfb) add --shots=/some/dir to save screenshots along the way.
extends Node

const NetScript := preload("res://net/net.gd")
const MATCH_SCENE := "res://game/match_scene.tscn"
const STEP_TIMEOUT := 40.0

var a: Node
var b: Node
var scene: Node
var shots_dir := ""
var b_state: Dictionary = {}
var a_patches := 0
var b_patches := 0
var a_events: Array[String] = []
var b_events: Array[String] = []
var errors: Array[String] = []


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--shots="):
			shots_dir = arg.trim_prefix("--shots=")
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	a = get_node("/root/Net")
	b = NetScript.new()
	b.name = "NetB"
	add_child(b)
	for n: Node in [a, b]:
		n.enter_failed.connect(func(m: String) -> void: errors.append("%s enter_failed: %s" % [n.name, m]))
		n.server_error.connect(
			func(code: String, m: String) -> void: errors.append("%s server_error %s: %s" % [n.name, code, m])
		)
		n.disconnected.connect(func(m: String) -> void: errors.append("%s disconnected: %s" % [n.name, m]))
	a.terrain_patch.connect(func(_m: Dictionary) -> void: a_patches += 1)
	b.terrain_patch.connect(func(_m: Dictionary) -> void: b_patches += 1)
	a.view_events.connect(func(m: Dictionary) -> void: _note_events(a_events, m))
	b.view_events.connect(func(m: Dictionary) -> void: _note_events(b_events, m))
	b.view_state.connect(func(m: Dictionary) -> void: b_state = m)
	b.match_started.connect(func(m: Dictionary) -> void: b_state = m.get("state", {}))
	var ok := await _run()
	if ok:
		print("E2E PASS")
	get_tree().quit(0 if ok else 1)


func _run() -> bool:
	print("E2E server: ", NetConfig.server_base())
	await _preview("res://ui/title.tscn", "0a-title")
	a.enter_room("create", "Alba")
	if not await _until(func() -> bool: return a.lobby.code() != "", "A to create a room"):
		return false
	var code: String = a.lobby.code()
	b.enter_room("join", "Bram", code)
	if not await _until(func() -> bool: return b.lobby.code() == code, "B to join the room"):
		return false
	if not await _until(func() -> bool: return a.lobby.members().size() == 2, "A to see both players"):
		return false

	# Short turns and a fixed map, as in the server's own two-player tests.
	a.call("_send", "lobby.setSettings", {"patch": {"turnSeconds": 90, "crittersPerTeam": 2, "mapSeed": 99}})
	a.set_ready(true)
	b.set_ready(true)
	if not await _until(func() -> bool: return a.lobby.can_start(), "the room to be startable"):
		return false
	await _preview("res://ui/lobby.tscn", "0b-lobby")
	a.start_match()
	if not await _until(
		func() -> bool: return not a.current_match_start().is_empty() and not b.current_match_start().is_empty(),
		"match.start on both clients"
	):
		return false
	var start: Dictionary = a.current_match_start()
	print("E2E match.start bytes of terrain: ", str(start.get("terrain", {}).get("density", "")).length())

	scene = (load(MATCH_SCENE) as PackedScene).instantiate()
	add_child(scene)
	if not await _until(func() -> bool: return scene.vm.started, "the match scene to start"):
		return false
	var tv: Node = scene.terrain_view
	if tv == null:
		return _fail("the match scene has no terrain view")
	var t0 := Time.get_ticks_msec()
	if not await _until(func() -> bool: return tv.pending() == 0, "the island to finish meshing", 120.0):
		return false
	print("E2E island meshed in %d ms, %d chunk nodes" % [Time.get_ticks_msec() - t0, tv.get_child_count()])
	if tv.get_child_count() == 0:
		return _fail("the island has no mesh")

	# The decoded island must agree with the server: every grounded critter stands on the surface.
	if not await _until(func() -> bool: return _snap()["phase"] == "control", "the first turn"):
		return false
	var v := _snap()
	if (v["critters"] as Array).size() != 4:
		return _fail("expected 4 critters, got %d" % (v["critters"] as Array).size())
	for c: Dictionary in v["critters"]:
		var p: Vector3 = c["pos"]
		var g: float = scene.ground_y(p.x, p.z)
		if c["grounded"] and absf(g - p.y) > 2.0:
			return _fail("critter %d stands at y=%.2f but the island surface there is %.2f" % [c["id"], p.y, g])
	if not v["my_turn"]:
		return _fail("turn 1 should be A's (team 0); local teams are %s" % [scene.vm.local_teams])
	await _shot("1-start")

	# A fires an acorn mortar toward the middle of the island.
	var me: Dictionary = {}
	for c: Dictionary in v["critters"]:
		if int(c["id"]) == int(v["active_critter_id"]):
			me = c
	if me.is_empty():
		return _fail("no active critter in the state")
	var size: Vector2 = scene.get("_world")
	var from: Vector3 = me["pos"]
	var yaw := int(round(atan2(size.y * 0.5 - from.z, size.x * 0.5 - from.x) / TAU * 1024.0))
	yaw = ((yaw % 1024) + 1024) % 1024
	a.send_input(int(v["turn"]), [{"k": "fire", "weaponId": "acorn-mortar", "yaw": yaw, "pitch": 55, "power": 35}])
	if not await _until(func() -> bool: return a_events.has("fired") and b_events.has("fired"), "the shot on both clients"):
		return false
	await _shot("2-shot")
	if not await _until(
		func() -> bool: return a_events.has("explosion") and b_events.has("explosion"), "the explosion on both clients"
	):
		return false
	if not await _until(func() -> bool: return a_patches > 0 and b_patches > 0, "a terrain patch on both clients"):
		return false
	if not await _until(func() -> bool: return tv.pending() == 0, "the crater to be meshed"):
		return false
	await _shot("3-crater")

	# The turn passes to B, who skips; then it is A's again.
	if not await _until(func() -> bool: return _turn(_snap_turns()) == 2 and _turn(b_state.get("turns", {})) == 2, "turn 2"):
		return false
	if _snap()["my_turn"]:
		return _fail("turn 2 should be B's")
	b.send_input(2, [{"k": "skip"}])
	if not await _until(func() -> bool: return _turn(_snap_turns()) == 3 and _turn(b_state.get("turns", {})) == 3, "turn 3"):
		return false
	await _shot("4-turn3")
	scene.pause.open()
	await _shot("7-pause")
	scene.pause._open_settings()
	await _shot("8-settings")
	scene.pause.close()
	if a_patches != b_patches:
		return _fail("clients saw different patch counts: %d and %d" % [a_patches, b_patches])
	if not errors.is_empty():
		return _fail("errors along the way: %s" % [errors])
	return true


func _snap() -> Dictionary:
	return scene.vm.snapshot()


func _snap_turns() -> Dictionary:
	return scene.vm.turns


static func _turn(turns: Dictionary) -> int:
	return int(turns.get("turn", 0))


static func _note_events(into: Array[String], msg: Dictionary) -> void:
	for e: Dictionary in msg.get("events", []):
		into.append(str(e.get("type", "")))


## Poll `cond` every frame until it is true. Fails the run on a timeout or any reported error.
func _until(cond: Callable, what: String, timeout := STEP_TIMEOUT) -> bool:
	var deadline := Time.get_ticks_msec() + int(timeout * 1000.0)
	while not cond.call():
		if not errors.is_empty():
			return _fail("while waiting for %s: %s" % [what, errors])
		if Time.get_ticks_msec() > deadline:
			return _fail("timed out waiting for %s" % what)
		await get_tree().process_frame
	print("E2E ok: ", what)
	return true


func _fail(why: String) -> bool:
	print("E2E FAIL: ", why)
	if scene != null and scene.vm.started:
		print("E2E state: turns=", scene.vm.turns, " patches=", a_patches, "/", b_patches)
		print("E2E events A=", a_events, " B=", b_events)
	return false


## Save a screenshot when --shots was given and there is a real renderer.
## Build a menu screen on top of the test for a few frames (and a screenshot), then remove it
## before the next step, so its own scene changes never fire.
func _preview(scene_path: String, shot_name: String) -> void:
	var screen: Node = (load(scene_path) as PackedScene).instantiate()
	add_child(screen)
	for i in 5:
		await get_tree().process_frame
	await _shot(shot_name)
	remove_child(screen)
	screen.queue_free()
	await get_tree().process_frame
	print("E2E ok: built ", scene_path)


func _shot(shot_name: String) -> void:
	if shots_dir == "" or DisplayServer.get_name() == "headless":
		return
	for i in 20:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := shots_dir.path_join(shot_name + ".png")
	if img == null or img.save_png(path) != OK:
		print("E2E could not save ", path)
	else:
		print("E2E saved ", path)
