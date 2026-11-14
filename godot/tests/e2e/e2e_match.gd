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
## --theme=<id> picks the map theme; --tour stops after the first-turn screenshots (a map preview).
var theme := "toybox-harbor"
var tour := false
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
		if arg.begins_with("--theme="):
			theme = arg.trim_prefix("--theme=")
		if arg == "--tour":
			tour = true
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
	await _preview("res://ui/how_to_play.tscn", "0c-howto")
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
	a.call("_send", "lobby.setSettings", {"patch": {"turnSeconds": 90, "crittersPerTeam": 2, "mapSeed": 99, "mapTheme": theme, "mapSize": 256}})
	# A settings change un-readies everyone. Over a real network B's ready can reach the server
	# before A's settings, so wait for both clients to see the settings before readying.
	if not await _until(
		func() -> bool: return int(a.lobby.settings().get("mapSeed", -1)) == 99 and int(b.lobby.settings().get("mapSeed", -1)) == 99,
		"the settings on both clients"
	):
		return false
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
	# The software renderer in CI takes seconds per frame once terrain is on screen, and chunks are
	# handed out per frame. Keep the world hidden while it builds so the turn timer is not used up.
	scene.visible = false
	var meshed: bool = await _until(func() -> bool: return tv.pending() == 0, "the island to finish meshing", 120.0)
	scene.visible = true
	if not meshed:
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
	if tour:
		# A look from above at the whole island, then done.
		scene._rig.dist = 160.0
		scene._rig.pitch_deg = 50.0
		await _shot("overview", 6)
		print("E2E ok: tour of ", theme)
		return true

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
	# A blast right where the camera looks, photographed within a few frames so it is still going.
	var rig: Variant = scene.get("_rig")
	# The software renderer takes seconds per frame and effects run on the engine clock, so a
	# blast is over before the first picture. Slow the clock, let about a quarter of a second of
	# effect time pass, then freeze it for the capture.
	# On dry land next to the active Squirmling. The mortar shell above landed out in the soda, and
	# the camera follows that crater, so it sat under the sea surface (blue tint, no fireball).
	var ahead := Vector3.RIGHT.rotated(Vector3.UP, deg_to_rad(float(me["heading_deg"])))
	var blast_at: Vector3 = (me["pos"] as Vector3) + ahead * 8.0
	blast_at.y = scene.ground_y(blast_at.x, blast_at.z) + 1.0
	if blast_at.y <= scene.vm.sea_y + 2.0:
		blast_at = (me["pos"] as Vector3) + Vector3(0, 1.0, 0)
	# Point the camera at it too, and hold it there for the capture.
	scene.set("_blast_at", blast_at)
	scene.set("_blast_left", 5.0)
	rig.target = blast_at
	scene.fx.explode(blast_at, 12.0)
	print("E2E blast: %d effect nodes, camera %s looking at %s" % [scene.fx.get_child_count(), scene.camera.global_position, rig.target])
	await _freeze_after(0.25)
	await _shot("2b-blast", 1)
	Engine.time_scale = 1.0
	var sea: float = scene.vm.sea_y
	var mid: Vector2 = scene.get("_world")
	scene.fx.splash(Vector3(mid.x * 0.5, sea, mid.y * 0.5 + 40.0), 5.0)
	await _freeze_after(0.2)
	await _shot("2c-splash", 1)
	Engine.time_scale = 1.0
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
	# The practice prompts, shown over this match so the banner is exercised and pictured.
	scene._setup_guide(true)
	for i in 3:
		await get_tree().process_frame
	if scene._guide == null or scene._guide_label == null or scene._guide_label.get_parsed_text() == "":
		return _fail("the practice guide shows no prompt")
	await _shot("5-practice", 1)
	# The new steps, one picture each: a utility, then a crate.
	for pair in [[7, "5b-practice-utility"], [8, "5c-practice-crate"]]:
		scene._guide.step = pair[0]
		for i in 3:
			await get_tree().process_frame
		if not scene._guide_label.get_parsed_text().begins_with("Practice %d of" % (pair[0] + 1)):
			return _fail("practice step %d shows the wrong prompt: %s" % [pair[0] + 1, scene._guide_label.get_parsed_text()])
		await _shot(pair[1], 1)
	scene._setup_guide(false)
	# The close look comes last: under the software renderer it can outlast a turn.
	await _closeup(_snap())
	scene.pause.open()
	await _shot("7-pause")
	scene.pause._open_settings()
	await _shot("8-settings")
	scene.pause.close()
	scene.hud._weapon_grid.open()
	await _shot("9-weapons")
	scene.hud._weapon_grid.close()
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
	if tour:
		return
	var screen: Node = (load(scene_path) as PackedScene).instantiate()
	add_child(screen)
	for i in 5:
		await get_tree().process_frame
	await _shot(shot_name)
	remove_child(screen)
	screen.queue_free()
	await get_tree().process_frame
	print("E2E ok: built ", scene_path)


## A close look at the active Squirmling: standing, hit, and a stand-in next to it popping apart
## and leaving its marker. Runs headless too (without pictures) so the animation code is exercised.
func _closeup(v: Dictionary) -> void:
	var me: Dictionary = {}
	for c: Dictionary in v["critters"]:
		if int(c["id"]) == int(v["active_critter_id"]):
			me = c
	var rig: SquirmlingRig = scene._critters.get(int(me.get("id", -1)), null)
	if rig == null:
		return
	var old_dist: float = scene._rig.dist
	var old_pitch: float = scene._rig.pitch_deg
	var old_yaw: float = scene._rig.yaw_deg
	scene._rig.dist = 13.0
	scene._rig.pitch_deg = 10.0
	# Stand the camera in front of the face, a little to one side.
	var face: Vector3 = rig.global_transform.basis.z
	scene._rig.yaw_deg = CameraMath.wrap_deg(rad_to_deg(atan2(face.x, face.z)) + 25.0)
	await _shot("1b-squirmling", 5)
	rig.hurt()
	await _shot("1c-hurt", 3)
	rig.fire()
	await _shot("1d-fire", 2)

	var twin := Squirmling.create(1, "chef", Color("4aa3df"))
	var right := Vector3.RIGHT.rotated(Vector3.UP, deg_to_rad(float(me["heading_deg"])))
	var at: Vector3 = (me["pos"] as Vector3) + right * 5.0
	at.y = scene.ground_y(at.x, at.z)
	twin.position = at
	twin.rotation.y = rig.rotation.y
	scene.add_child(twin)
	twin.drive(0.016, false, Vector3.ZERO, true)
	twin.set_alive(false)
	# Stepped by hand, not by the clock: headless frames take no time and software ones seconds.
	for i in 8:
		twin.drive(0.05, false, Vector3.ZERO, true)
	await _shot("1e-pop", 1)
	for i in 60:
		twin.drive(0.05, false, Vector3.ZERO, true)
	if twin.pop_time >= 0.0:
		errors.append("the knocked-out Squirmling never finished popping")
	await _shot("1f-marker", 2)
	scene.remove_child(twin)
	twin.queue_free()
	await _gear_row(me, rig)
	scene._rig.dist = old_dist
	scene._rig.pitch_deg = old_pitch
	scene._rig.yaw_deg = old_yaw
	print("E2E ok: Squirmling close-up")


func _shot(shot_name: String, frames := 5) -> void:
	if shots_dir == "" or DisplayServer.get_name() == "headless":
		return
	for i in frames:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := shots_dir.path_join((theme + "-" if tour else "") + shot_name + ".png")
	if img == null or img.save_png(path) != OK:
		print("E2E could not save ", path)
	else:
		print("E2E saved ", path)


## Four stand-ins wearing the utilities (jetpack, umbrella, boots, drill), one with the rope and
## a shield, and two Jelly Mines (arming, armed), all next to the active Squirmling.
func _gear_row(me: Dictionary, rig: SquirmlingRig) -> void:
	var right := Vector3.RIGHT.rotated(Vector3.UP, deg_to_rad(float(me["heading_deg"])))
	var forward := Vector3.FORWARD.rotated(Vector3.UP, deg_to_rad(float(me["heading_deg"])))
	var gear := GearFx.new()
	scene.add_child(gear)
	var views := ShotViews.new()
	scene.add_child(views)
	var crowd: Array = []
	var list: Array = []
	var acts := ["jetpack", "umbrella", "boots", "drill", "rope", "gatling"]
	var offsets := [-14.0, -7.0, 7.0, 14.0, 21.0, 28.0]
	for i in 6:
		var at: Vector3 = (me["pos"] as Vector3) + right * float(offsets[i])
		at.y = scene.ground_y(at.x, at.z)
		var grounded: bool = acts[i] != "jetpack" and acts[i] != "umbrella"
		var lift := 0.0 if grounded else 6.0
		var twin := Squirmling.create(1, "chef", Color("4aa3df"))
		twin.position = at + Vector3(0, lift, 0)
		twin.rotation.y = rig.rotation.y
		scene.add_child(twin)
		twin.drive(0.016, false, Vector3.ZERO, grounded)
		crowd.append(twin)
		var c := {
			"id": 900 + i, "pos": twin.position, "heading_deg": rad_to_deg(rig.rotation.y), "alive": true,
			"grounded": grounded, "act": acts[i], "shield": acts[i] == "rope", "anchor": twin.position + Vector3(6, 26, 0)
		}
		list.append(c)
	# A fire puddle and a glue puddle, and the ice shell and feather glow on two more stand-ins.
	var zone_list: Array = []
	for i in 2:
		var zat: Vector3 = (me["pos"] as Vector3) + right * (-9.0 + 18.0 * float(i)) + forward * 14.0
		zat.y = scene.ground_y(zat.x, zat.z)
		zone_list.append({"id": 1 + i, "kind": "fire" if i == 0 else "glue", "pos": zat, "r": 5.0, "turns": 2})
	var zones := ZoneViews.new()
	scene.add_child(zones)
	for i in 2:
		var zat: Vector3 = (me["pos"] as Vector3) + right * (-5.0 + 10.0 * float(i)) - forward * 8.0
		zat.y = scene.ground_y(zat.x, zat.z)
		var twin2 := Squirmling.create(1, "chef", Color("4aa3df"))
		twin2.position = zat
		twin2.rotation.y = rig.rotation.y
		scene.add_child(twin2)
		twin2.drive(0.016, false, Vector3.ZERO, true)
		crowd.append(twin2)
		list.append(
			{
				"id": 910 + i, "pos": zat, "heading_deg": rad_to_deg(rig.rotation.y), "alive": true,
				"grounded": true, "act": "", "frozen": i == 0, "feather": i == 1
			}
		)
	var steered: Array = []
	var weapons := ["wind-up-robot", "marble-roller", "rc-racer", "kite-bomber", "paper-lantern", "giant-block", "meteor-marble", "pinata", "candy-bomb"]
	for i in weapons.size():
		var back_row := i >= 4
		var col := i - 4 if back_row else i
		var sat: Vector3 = (me["pos"] as Vector3) + right * (-10.0 + (8.0 if back_row else 7.0) * float(col)) + forward * (32.0 if back_row else 20.0)
		sat.y = scene.ground_y(sat.x, sat.z) + (4.0 if weapons[i] == "kite-bomber" else 0.0)
		if back_row and weapons[i] != "giant-block" and weapons[i] != "pinata":
			sat.y += 5.0
		steered.append({"id": 50 + i, "weapon": weapons[i], "pos": sat, "heading_deg": rad_to_deg(rig.rotation.y) + 40.0})
	var mines: Array = []
	for i in 2:
		var at: Vector3 = (me["pos"] as Vector3) + right * (-3.0 + 6.0 * float(i)) + forward * 7.0
		at.y = scene.ground_y(at.x, at.z) + 0.2
		mines.append({"id": 1 + i, "weapon": "jelly-mine", "pos": at, "armed": i == 1, "triggered": false})
	var trap_at: Vector3 = (me["pos"] as Vector3) + forward * 11.0 + right * 3.0
	trap_at.y = scene.ground_y(trap_at.x, trap_at.z) + 0.2
	mines.append({"id": 9, "weapon": "mousetrap-snapper", "pos": trap_at, "armed": true, "triggered": false})
	scene._rig.dist = 46.0
	scene._rig.pitch_deg = 14.0
	for i in 4:
		gear.sync(list, 0.05)
		views.sync(steered, mines)
		zones.sync(zone_list, 0.05)
		await get_tree().process_frame
	await _shot("1g-gear", 3)
	for c: Dictionary in list:
		c["act"] = ""
		c["shield"] = false
	gear.sync(list, 0.05)
	if not (gear.state_of(910)["frozen"] and gear.state_of(911)["feather"]):
		errors.append("the ice shell or the feather glow is missing")
	for c: Dictionary in list:
		c["frozen"] = false
		c["feather"] = false
	gear.sync(list, 0.05)
	if not gear.state_of(900).is_empty():
		errors.append("gear stayed after the acts ended")
	for t: Node in crowd:
		scene.remove_child(t)
		t.queue_free()
	scene.remove_child(gear)
	gear.queue_free()
	scene.remove_child(views)
	views.queue_free()
	scene.remove_child(zones)
	zones.queue_free()
	print("E2E ok: gear and mines")


## Run the engine clock slowly until `seconds` of effect time have passed (or 40 frames), then
## stop it, so the next screenshot shows the effect part-way through. Does nothing without a
## real renderer. Callers put `Engine.time_scale` back to 1.
func _freeze_after(seconds: float) -> void:
	if shots_dir == "" or DisplayServer.get_name() == "headless":
		return
	Engine.time_scale = 0.05
	var passed := 0.0
	for i in 40:
		await get_tree().process_frame
		passed += get_process_delta_time()
		if passed >= seconds:
			break
	Engine.time_scale = 0.0
