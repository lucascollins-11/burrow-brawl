## Agent playtest harness: plays the real game from a list of steps and writes what it saw.
##
## A Claude session (or a person) describes a playthrough as JSON steps ("start a match", "walk
## forward for a second", "fire at the nearest enemy", "open the pause menu"). Each step is done
## through the same code paths a player uses (key events, the Controls node, the HUD, the menus),
## then the harness saves a screenshot (when there is a renderer) and a state dump: turn, phase,
## timer, every critter's HP and position, the weapon, the HUD banner and hint, the tutorial
## prompt, which menus are open, events since the last step and any errors.
##
##   godot --path godot res://tests/playtest/playtest.tscn -- --server=http://127.0.0.1:8080 \
##       --scenario=res://tests/playtest/scenarios/smoke.json --out=/tmp/pt
##
## --inbox=<file> keeps the game running after the scenario and does each new JSON line appended
## to that file (interactive mode; tools/playtest/pt.sh drives it). The step list and the report
## format are in docs/agent-playtest.md. Exit code: 0 when every step passed, 1 otherwise.
extends Node

const NetScript := preload("res://net/net.gd")
const Codec := preload("res://terrain/voxel_codec.gd")
const MATCH_SCENE := "res://game/match_scene.tscn"
const SCREENS := {
	"title": "res://ui/title.tscn",
	"howto": "res://ui/how_to_play.tscn",
	"lobby": "res://ui/lobby.tscn",
}
const WALK := {"forward": "move_forward", "back": "move_back", "left": "move_left", "right": "move_right"}
## Launch model for the aim helper, in voxels and ticks, from shared/src/sim3d: a charged shot at
## power 100 leaves at the weapon's maxSpeed in units/s (x 3/10 / 60 voxels per tick) and falls at
## gravity 600 units/s^2 (0.05 voxels per tick^2). Wind is ignored, so it is a first guess that
## aim_scale corrects after each shot. maxSpeed by weapon, from shared/weapons/*.json (default 600).
const MAX_SPEED := {
	"acorn-mortar": 900, "fizz-grenade": 700, "fizz-rocket": 1000, "glue-puddle": 800, "gumball-cluster": 700,
	"hopper-ball": 700, "hot-sauce-flask": 800, "pinecone-popper": 800, "slingshot": 1100, "snow-globe": 700,
	"marble-roller": 500,
}
const GRAVITY := 0.05
const STEP_TIMEOUT := 60.0

var out_dir := ""
var scenario_path := ""
var inbox_path := ""
var idle_limit := 900.0
var shots_on := false
var stop_on_fail := false

var a: Node
var b: Node = null
var scene: Node = null
var screen: Node = null
var opponent := "fire"
var mode := ""

var step_no := 0
var failures := 0
var _events: Array = []
var _blasts: Array[Vector3] = []
## Learned correction for the aim helper's power: range grows with power squared, so after each
## shot it is nudged by sqrt(wanted distance / landed distance). Wind and drag end up in here.
var aim_scale := 1.0
var _b_acted_turn := -1
var _b_wait := 0.0
var _errors: Array[String] = []
var _rows: Array[String] = []
var _jsonl: FileAccess
var _t0 := 0


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--scenario="):
			scenario_path = arg.trim_prefix("--scenario=")
		elif arg.begins_with("--out="):
			out_dir = arg.trim_prefix("--out=")
		elif arg.begins_with("--inbox="):
			inbox_path = arg.trim_prefix("--inbox=")
		elif arg.begins_with("--idle="):
			idle_limit = float(arg.trim_prefix("--idle="))
		elif arg == "--stop-on-fail":
			stop_on_fail = true
	if out_dir == "":
		out_dir = ProjectSettings.globalize_path("user://playtest")
	DirAccess.make_dir_recursive_absolute(out_dir.path_join("shots"))
	shots_on = DisplayServer.get_name() != "headless"
	_jsonl = FileAccess.open(out_dir.path_join("steps.jsonl"), FileAccess.WRITE)
	_t0 = Time.get_ticks_msec()
	a = get_node("/root/Net")
	_watch_net(a)
	a.view_events.connect(func(m: Dictionary) -> void: _note_events(m))
	print("PLAYTEST server: ", NetConfig.server_base(), " out: ", out_dir, " shots: ", shots_on)

	var steps: Array = []
	if scenario_path != "":
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(scenario_path))
		if parsed is Dictionary:
			steps = parsed.get("steps", [])
		elif parsed is Array:
			steps = parsed
		else:
			_errors.append("could not read the scenario %s" % scenario_path)
	for s: Variant in steps:
		if s is Dictionary:
			var ok := await _run_step(s)
			if not ok and stop_on_fail:
				break
			if str(s.get("do", "")) == "quit":
				break
	if inbox_path != "":
		await _serve_inbox()
	_write_report()
	print("PLAYTEST DONE steps=%d failed=%d report=%s" % [step_no, failures, out_dir.path_join("report.md")])
	get_tree().quit(0 if failures == 0 else 1)


# ------------------------------------------------------------------ steps


func _run_step(s: Dictionary) -> bool:
	step_no += 1
	var what := str(s.get("do", ""))
	var started := Time.get_ticks_msec()
	_errors.clear()
	var res: Dictionary = await _dispatch(what, s)
	var ok: bool = res.get("ok", false) and _errors.is_empty()
	if not ok:
		failures += 1
	var label := str(s.get("name", what))
	var shot := ""
	if bool(s.get("shot", true)) and what != "quit":
		shot = await _shot("%02d-%s" % [step_no, label.validate_filename()])
	var row := {
		"step": step_no,
		"do": what,
		"args": s,
		"ok": ok,
		"error": str(res.get("error", "")) + ("" if _errors.is_empty() else " " + "; ".join(_errors)),
		"note": str(res.get("note", "")),
		"shot": shot,
		"ms": Time.get_ticks_msec() - started,
		"t_s": snappedf((Time.get_ticks_msec() - _t0) / 1000.0, 0.1),
		"events": _events.duplicate(),
		"state": _state(),
	}
	_events.clear()
	_jsonl.store_line(JSON.stringify(row))
	_jsonl.flush()
	var f := FileAccess.open(out_dir.path_join("last.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify(row, "  "))
	f.close()
	_rows.append(_row_md(row))
	print("PLAYTEST step %d %s %s %s %s" % [step_no, what, "ok" if ok else "FAIL", row["error"], row["note"]])
	return ok


func _dispatch(what: String, s: Dictionary) -> Dictionary:
	match what:
		"start":
			return await _start(s)
		"screen":
			return await _screen(s)
		"camera_trace":
			return await _camera_trace(s)
		"camera_sim":
			return await _camera_sim(s)
		"device":
			return await _device(s)
		"practice_setup":
			return await _practice_setup(s)
		"wait":
			await _seconds(float(s.get("seconds", 1.0)))
			return _ok()
		"wait_for":
			return await _wait_for(str(s.get("until", "my_turn")), float(s.get("timeout", STEP_TIMEOUT)))
		"key":
			return await _key(str(s.get("action", "")), float(s.get("seconds", 0.1)))
		"hold":
			return await _key(str(s.get("action", "")), float(s.get("seconds", 1.0)))
		"walk":
			if not WALK.has(str(s.get("dir", "forward"))):
				return _fail("dir must be one of %s" % [WALK.keys()])
			return await _key(WALK[str(s.get("dir", "forward"))], float(s.get("seconds", 1.0)))
		"weapon":
			return await _weapon(str(s.get("id", "")))
		"aim":
			return await _aim(s, false)
		"fire":
			return await _aim(s, true)
		"skip":
			return await _key("skip", 0.1)
		"camera":
			return await _camera(s)
		"view":
			return await _view(s)
		"carve":
			return await _carve(s)
		"sky":
			# Change weather and time of day in the running match (looks only).
			if scene == null:
				return _fail("no match")
			scene.set_sky(str(s.get("weather", "clear")), str(s.get("time", "day")))
			await _frames(int(s.get("frames", 8)))
			return _ok("sky %s" % [scene.sky])
		"strike":
			# A lightning strike now (storm screenshots), then wait `frames` for the flash.
			if scene == null or scene.weather == null:
				return _fail("no match")
			scene.weather.strike()
			await _frames(int(s.get("frames", 2)))
			return _ok("lightning strike %d, sky %s" % [scene.weather.strikes, scene.sky])
		"menu":
			return await _menu(str(s.get("open", "none")))
		"opponent":
			opponent = str(s.get("policy", "fire"))
			return _ok("opponent will " + opponent)
		"play_turns":
			return await _play_turns(int(s.get("count", 2)), s)
		"state", "shot":
			await _frames(3)
			return _ok()
		"quit":
			return _ok()
	return _fail("unknown step '%s'" % what)


func _ok(note := "") -> Dictionary:
	return {"ok": true, "note": note}


func _fail(why: String) -> Dictionary:
	return {"ok": false, "error": why}


## {do:start, mode: practice|match, theme, size, critters, seed, turn_seconds, opponent}
func _start(s: Dictionary) -> Dictionary:
	if scene != null:
		return _fail("a match is already running")
	_close_screen()
	mode = str(s.get("mode", "match"))
	opponent = str(s.get("opponent", opponent))
	if not (mode == "practice" and a.lobby.is_active() and a.lobby.code() != ""):
		a.enter_room("create", str(s.get("name", "Tester")))
	if not await _until(func() -> bool: return a.lobby.code() != "", 40.0):
		return _fail("no room was created (server down or asleep?)")
	if mode == "practice":
		if s.has("seed"):
			# A fixed map, so two runs (say before and after a change) walk the same streets.
			var seed_value := int(s["seed"])
			a.set_settings({"mapSeed": seed_value})
			if not await _until(func() -> bool: return int(a.lobby.settings().get("mapSeed", -1)) == seed_value):
				return _fail("the map seed did not apply")
		# After a practice_setup step the room already holds the chosen map; else use the saved choices.
		a.start_practice(int(s.get("turn_seconds", GameSettings.practice_turn)))
	else:
		b = NetScript.new()
		b.name = "Rival"
		add_child(b)
		_watch_net(b)
		var code: String = a.lobby.code()
		b.enter_room("join", str(s.get("rival", "Rival")), code)
		if not await _until(func() -> bool: return a.lobby.members().size() == 2):
			return _fail("the rival did not join")
		var patch := {
			"turnSeconds": int(s.get("turn_seconds", 60)),
			"crittersPerTeam": int(s.get("critters", 2)),
			"mapSeed": int(s.get("seed", 99)),
			"mapSize": int(s.get("size", 256)),
		}
		if s.has("theme"):
			patch["mapTheme"] = str(s["theme"])
		if s.has("weather"):
			patch["weather"] = str(s["weather"])
		if s.has("time"):
			patch["timeOfDay"] = str(s["time"])
		a.set_settings(patch)
		# Settings un-ready everyone, so wait for them to land before readying (else a race).
		if not await _until(func() -> bool: return int(a.lobby.settings().get("mapSeed", -1)) == patch["mapSeed"] and int(b.lobby.settings().get("mapSeed", -1)) == patch["mapSeed"]):
			return _fail("the lobby settings did not apply: %s" % [a.lobby.settings()])
		a.set_ready(true)
		b.set_ready(true)
		if not await _until(func() -> bool: return a.lobby.can_start()):
			return _fail("the room never became startable")
		a.start_match()
	if not await _until(func() -> bool: return not a.current_match_start().is_empty()):
		return _fail("no match.start arrived")
	scene = (load(MATCH_SCENE) as PackedScene).instantiate()
	add_child(scene)
	if not await _until(func() -> bool: return scene.vm.started):
		return _fail("the match scene did not start")
	var tv: Node = scene.terrain_view
	var t := Time.get_ticks_msec()
	# The software renderer is slow per frame; keep the world hidden while chunks mesh.
	scene.visible = false
	var meshed := await _until(func() -> bool: return tv == null or tv.pending() == 0, 180.0)
	scene.visible = true
	if not meshed:
		return _fail("the island did not finish meshing")
	if not await _until(func() -> bool: return _snap()["phase"] == "control"):
		return _fail("the first turn never started")
	return _ok("%s match, island meshed in %d ms, room %s" % [mode, Time.get_ticks_msec() - t, a.lobby.code()])


## {do:wait_for, until: my_turn|their_turn|control|turn_end|settled|over, timeout}
func _wait_for(until: String, timeout: float) -> Dictionary:
	if scene == null:
		return _fail("no match")
	var turn := int(_snap()["turn"])
	var conds := {
		"my_turn": func() -> bool: return _snap()["my_turn"] and _snap()["phase"] == "control",
		"their_turn": func() -> bool: return not _snap()["my_turn"] and _snap()["phase"] == "control",
		"control": func() -> bool: return _snap()["phase"] == "control",
		"turn_end": func() -> bool: return int(_snap()["turn"]) != turn,
		"settled": func() -> bool: return _snap()["phase"] != "settling" and (_snap()["projectiles"] as Array).is_empty(),
		"over": func() -> bool: return _snap()["phase"] == "over",
	}
	if not conds.has(until):
		return _fail("until must be one of %s" % [conds.keys()])
	var t := Time.get_ticks_msec()
	if not await _until(conds[until], timeout):
		return _fail("timed out after %.0f s waiting for %s" % [timeout, until])
	return _ok("%s after %.1f s" % [until, (Time.get_ticks_msec() - t) / 1000.0])


## {do:screen, scene: title|howto|lobby|settings, page (howto), tab (settings)}
func _screen(s: Dictionary) -> Dictionary:
	var which := str(s.get("scene", "title"))
	_close_screen()
	if which == "settings":
		screen = SettingsMenu.new()
	elif SCREENS.has(which):
		screen = (load(SCREENS[which]) as PackedScene).instantiate()
	else:
		return _fail("scene must be title, howto, lobby or settings")
	if scene != null:
		scene.visible = false
	add_child(screen)
	await _frames(5)
	if which == "settings" and s.has("tab"):
		screen._tabs.current_tab = int(s["tab"])
		await _frames(2)
	if which == "howto" and s.has("page") and screen.has_method("_show"):
		screen.call("_show", int(s["page"]))
		await _frames(2)
	return _ok("showing " + which + ("" if not s.get("keep", false) else " (kept)"))


## {do:practice_setup, theme, size, turn_seconds}: open the real practice setup screen (a room is
## created for it), optionally pick values on it, and leave it showing for a screenshot. A later
## `start` with mode practice reuses the room.
func _practice_setup(s: Dictionary) -> Dictionary:
	_close_screen()
	if not (a.lobby.is_active() and a.lobby.code() != ""):
		a.enter_room("create", str(s.get("name", "Tester")))
		if not await _until(func() -> bool: return a.lobby.code() != "", 40.0):
			return _fail("no room was created (server down or asleep?)")
	a.practice_pending = true
	screen = (load(SCREENS["lobby"]) as PackedScene).instantiate()
	add_child(screen)
	await _frames(5)
	for pair in [["theme", "_theme_pick"], ["size", "_size_pick"], ["turn_seconds", "_turn_pick"]]:
		if not s.has(pair[0]):
			continue
		var pick: OptionButton = screen.get(pair[1])
		var found := false
		for i in range(pick.item_count):
			var have: Variant = pick.get_item_metadata(i)
			var same: bool = str(have) == str(s[pair[0]]) if have is String else int(have) == int(s[pair[0]])
			if same:
				pick.select(i)
				pick.item_selected.emit(i)
				found = true
		if not found:
			return _fail("no %s choice '%s' on the setup screen" % [pair[0], s[pair[0]]])
	await _seconds(0.6)
	return _ok("practice setup showing")


## {do:camera_trace, dir, seconds}: hold a walk key and record the camera every frame: its
## distance from its target and its height. The note gives the range of the distance, how much it
## moved in total, how many times it changed direction (pumping) and the biggest one-frame jump.
func _camera_trace(s: Dictionary) -> Dictionary:
	if scene == null:
		return _fail("no match")
	var dir := str(s.get("dir", "forward"))
	if not WALK.has(dir):
		return _fail("dir must be one of %s" % [WALK.keys()])
	_close_screen()
	var code := int(GameSettings.keys[WALK[dir]])
	var secs := float(s.get("seconds", 5.0))
	var dists: Array[float] = []
	var start := Time.get_ticks_msec()
	_send_key(code, true)
	while (Time.get_ticks_msec() - start) / 1000.0 < secs:
		await get_tree().process_frame
		dists.append(scene.camera.global_position.distance_to(scene._rig.target))
	_send_key(code, false)
	await _frames(2)
	if dists.size() < 3:
		return _fail("too few frames (%d) to measure" % dists.size())
	var lo := dists[0]
	var hi := dists[0]
	var travel := 0.0
	var flips := 0
	var biggest := 0.0
	var last_sign := 0
	for i in range(1, dists.size()):
		lo = minf(lo, dists[i])
		hi = maxf(hi, dists[i])
		var d := dists[i] - dists[i - 1]
		travel += absf(d)
		biggest = maxf(biggest, absf(d))
		if absf(d) > 0.05:
			var sgn := 1 if d > 0.0 else -1
			if last_sign != 0 and sgn != last_sign:
				flips += 1
			last_sign = sgn
	return _ok("walk %s %.0f s, %d frames: camera distance %.1f to %.1f (range %.1f), total movement %.1f, direction changes %d, biggest one-frame jump %.2f" % [dir, secs, dists.size(), lo, hi, hi - lo, travel, flips, biggest])


## {do:camera_sim, speed, seconds}: replay the camera at a steady 60 frames a second while the
## active critter's position walks a straight line over the terrain in each of four directions.
## The software renderer is too slow to measure the camera in real time, so this drives the
## camera update directly with a fixed step. The note gives, per direction, the camera distance
## range, total movement, direction changes and the biggest one-frame jump; the last line is the
## sum. Run it on two builds to compare.
func _camera_sim(s: Dictionary) -> Dictionary:
	if scene == null:
		return _fail("no match")
	_close_screen()
	var v := _snap()
	var me := _active(v)
	if me.is_empty():
		return _fail("no active critter")
	var speed := float(s.get("speed", 8.0))
	var secs := float(s.get("seconds", 6.0))
	var dt := 1.0 / 60.0
	var start: Vector3 = me["pos"]
	var parts: PackedStringArray = []
	var all_travel := 0.0
	var all_flips := 0
	var worst_jump := 0.0
	var worst_range := 0.0
	scene.set_process(false)
	for dir_deg in [0.0, 90.0, 180.0, 270.0]:
		var dir := Vector2(sin(deg_to_rad(dir_deg)), cos(deg_to_rad(dir_deg)))
		scene.set("_cam_pull", 1.0e9)
		scene.set("_cam_lift", 0.0)
		var dists: Array[float] = []
		var steps := int(secs / dt)
		for i in range(60 + steps):
			var walked := maxf(0.0, float(i - 60)) * dt * speed
			var x := clampf(start.x + dir.x * walked, 2.0, float(scene._world.x) - 2.0)
			var z := clampf(start.z + dir.y * walked, 2.0, float(scene._world.y) - 2.0)
			var critter := me.duplicate()
			critter["pos"] = Vector3(x, scene.ground_y(x, z) + 1.0, z)
			scene._update_camera(v, critter, null, {"dx": 0.0, "dy": 0.0, "wheel": 0.0}, dt)
			if i >= 60:
				dists.append(scene.camera.position.distance_to(scene._rig.target))
		var lo: float = dists.min()
		var hi: float = dists.max()
		var travel := 0.0
		var flips := 0
		var biggest := 0.0
		var last_sign := 0
		for i in range(1, dists.size()):
			var d := dists[i] - dists[i - 1]
			travel += absf(d)
			biggest = maxf(biggest, absf(d))
			if absf(d) > 0.1:
				var sgn := 1 if d > 0.0 else -1
				if last_sign != 0 and sgn != last_sign:
					flips += 1
				last_sign = sgn
		parts.append("%d deg: %.1f..%.1f (range %.1f), movement %.1f, changes %d, jump %.2f" % [int(dir_deg), lo, hi, hi - lo, travel, flips, biggest])
		all_travel += travel
		all_flips += flips
		worst_jump = maxf(worst_jump, biggest)
		worst_range = maxf(worst_range, hi - lo)
	scene.set_process(true)
	return _ok("%s | TOTAL movement %.1f, direction changes %d, biggest one-frame jump %.2f, widest range %.1f" % [" | ".join(parts), all_travel, all_flips, worst_jump, worst_range])


## {do:device, kind: keyboard|pad, family: xbox|playstation|switch}: pretend the player just used
## that device, so the HUD and tutorial prompts switch to its names and glyphs.
func _device(s: Dictionary) -> Dictionary:
	var kind := str(s.get("kind", "keyboard"))
	var family := str(s.get("family", "xbox"))
	if kind != "keyboard" and kind != "pad":
		return _fail("kind must be keyboard or pad")
	if kind == "pad" and not PadMap.FAMILIES.has(family):
		return _fail("family must be one of %s" % [PadMap.FAMILIES])
	get_node("/root/PadInput").use(kind, family)
	await _seconds(0.4)
	return _ok("prompts now follow %s" % [kind if kind == "keyboard" else family])


func _close_screen() -> void:
	if screen != null and is_instance_valid(screen):
		remove_child(screen)
		screen.queue_free()
	screen = null
	if scene != null:
		scene.visible = true


## Press (and after `seconds`, release) the key bound to an InputMap action, as a real key event.
func _key(action: String, seconds: float) -> Dictionary:
	if not GameSettings.keys.has(action):
		return _fail("unknown action '%s'; one of %s" % [action, GameSettings.keys.keys()])
	_close_screen()
	var code := int(GameSettings.keys[action])
	var before := _snap() if scene != null else {}
	_send_key(code, true)
	await _seconds(maxf(seconds, 0.05))
	_send_key(code, false)
	await _frames(2)
	if scene == null:
		return _ok()
	var me_before := _active(before)
	var me_after := _critter(_snap(), int(me_before.get("id", -1))) if not me_before.is_empty() else {}
	var note := ""
	if not me_before.is_empty() and not me_after.is_empty():
		var moved := (me_after["pos"] as Vector3).distance_to(me_before["pos"])
		note = "active critter moved %.1f voxels" % moved
	return _ok(note)


func _send_key(code: int, pressed: bool) -> void:
	var ev := InputEventKey.new()
	ev.physical_keycode = code as Key
	ev.keycode = code as Key
	ev.pressed = pressed
	Input.parse_input_event(ev)


func _weapon(id: String) -> Dictionary:
	if scene == null:
		return _fail("no match")
	if not scene.controls.select_id(id):
		var ids: Array = scene.controls.weapons.map(func(w: Dictionary) -> String: return w["id"])
		return _fail("no weapon '%s'; the match has %s" % [id, ids])
	await _frames(2)
	var team := int(scene.vm.local_teams[0]) if not scene.vm.local_teams.is_empty() else -1
	return _ok("%s, ammo %d (-1 = unlimited)" % [scene.controls.weapon_name(), scene.vm.ammo_left(team, id)])


## {do:aim|fire, weapon, at: nearest_enemy|center|critter id|{x,z}, yaw_deg, pitch, power, fuse,
##  watch (fire only, default true: wait for the shot to land and the turn to move on)}
func _aim(s: Dictionary, fire: bool) -> Dictionary:
	if scene == null:
		return _fail("no match")
	_close_screen()
	if s.has("weapon"):
		var w := await _weapon(str(s["weapon"]))
		if not w["ok"]:
			return w
	var v := _snap()
	if not v["my_turn"] or v["phase"] != "control":
		return _fail("not our turn to act (phase %s, my_turn %s)" % [v["phase"], v["my_turn"]])
	var me := _active(v)
	if me.is_empty():
		return _fail("no active critter")
	var c: Node = scene.controls
	if s.has("fuse"):
		c.fuse_seconds = clampi(int(s["fuse"]), 1, 5)
	var solved := _solve(v, me, s)
	if solved.has("error"):
		return _fail(solved["error"])
	var aim := CameraMath.new_aim(float(me["heading_deg"]))
	aim.yaw = solved["yaw"]
	aim.pitch_deg = solved["pitch"]
	aim.power = solved["power"]
	c.aim = aim
	await _frames(3)
	var note := "yaw %d pitch %d power %d%s" % [aim.yaw, aim.pitch_deg, int(aim.power), solved.get("note", "")]
	if not fire:
		return _ok(note)
	if c.needs("target"):
		var at: Vector3 = solved["target"]
		c.target = Vector3(at.x, scene.ground_y(at.x, at.z), at.z)
	var turn := int(v["turn"])
	_blasts.clear()
	c.call("_fire", c.aim)
	if not await _until(func() -> bool: return _events.has("fired") or int(_snap()["turn"]) != turn, 10.0):
		return _fail("the shot was not accepted (no 'fired' event); " + note)
	if not bool(s.get("watch", true)):
		return _ok(note)
	if shots_on and bool(s.get("flight_shot", true)):
		await _shot("%02d-in-flight" % step_no)
	var ended := await _until(func() -> bool: return int(_snap()["turn"]) != turn or _snap()["phase"] == "over", float(s.get("timeout", STEP_TIMEOUT)))
	if not _blasts.is_empty() and solved.has("aimed_at"):
		var target: Vector3 = solved["aimed_at"]
		var blast: Vector3 = _blasts[0]
		var from: Vector3 = me["pos"]
		var want := Vector2(target.x - from.x, target.z - from.z).length()
		var got := Vector2(blast.x - from.x, blast.z - from.z).length()
		note += "; blast %.0f voxels from the target (%s)" % [Vector2(blast.x - target.x, blast.z - target.z).length(), "short" if got < want else "long"]
		if got > 4.0 and not s.has("power"):
			aim_scale = clampf(aim_scale * clampf(sqrt(want / got), 0.8, 1.25), 0.6, 1.6)
	return _ok(note + ("" if ended else "; turn had not ended when the wait timed out"))


## Yaw, pitch and power for the aim helper.
func _solve(v: Dictionary, me: Dictionary, s: Dictionary) -> Dictionary:
	var from: Vector3 = me["pos"]
	var to: Variant = null
	var at: Variant = s.get("at", null)
	var world: Vector2 = scene.get("_world")
	if at is String and at == "nearest_enemy":
		var best := INF
		for c: Dictionary in v["critters"]:
			if c["alive"] and int(c["team"]) != int(me["team"]):
				var d := (c["pos"] as Vector3).distance_to(from)
				if d < best:
					best = d
					to = c["pos"]
		if to == null:
			return {"error": "no living enemy"}
	elif at is String and at == "center":
		to = Vector3(world.x * 0.5, scene.ground_y(world.x * 0.5, world.y * 0.5), world.y * 0.5)
	elif at is float or at is int:
		var c := _critter(v, int(at))
		if c.is_empty():
			return {"error": "no critter %s" % at}
		to = c["pos"]
	elif at is Dictionary:
		var x := float(at.get("x", 0))
		var z := float(at.get("z", 0))
		to = Vector3(x, scene.ground_y(x, z), z)
	var out := {}
	if to == null:
		out["yaw"] = CameraMath.deg_to_yaw(float(s.get("yaw_deg", me["heading_deg"])))
		out["pitch"] = int(s.get("pitch", 45))
		out["power"] = float(s.get("power", 60))
		out["target"] = from + Vector3(10, 0, 0)
		return out
	var d3: Vector3 = (to as Vector3) - from
	out["target"] = to
	out["aimed_at"] = to
	out["yaw"] = posmod(int(round(atan2(d3.z, d3.x) / TAU * 1024.0)), 1024)
	var dist := Vector2(d3.x, d3.z).length()
	var pitch := int(s.get("pitch", 45))
	var power := -1.0
	var speed := float(MAX_SPEED.get(scene.controls.weapon_id(), 600)) * 0.3 / 60.0
	for p in [pitch, 55, 65, 75]:
		power = _power_for(dist, d3.y, p, speed)
		if power > 0.0 and power <= 100.0:
			pitch = p
			break
	out["pitch"] = pitch
	out["power"] = float(s.get("power", clampf((power if power > 0.0 else 100.0) * aim_scale, 5.0, 100.0)))
	out["note"] = ", target %.0f voxels away, %+.0f up" % [dist, d3.y]
	return out


static func _power_for(dist: float, rise: float, pitch_deg: int, full_speed: float) -> float:
	var th := deg_to_rad(float(pitch_deg))
	var denom := 2.0 * cos(th) * cos(th) * (dist * tan(th) - rise)
	if denom <= 0.0:
		return -1.0
	return sqrt(GRAVITY * dist * dist / denom) / full_speed * 100.0


## {do:camera, dist, pitch, yaw, focus: active|center|overview}
func _camera(s: Dictionary) -> Dictionary:
	if scene == null:
		return _fail("no match")
	var rig: Variant = scene.get("_rig")
	var focus := str(s.get("focus", ""))
	if focus == "overview":
		rig.dist = 160.0
		rig.pitch_deg = 55.0
	if s.has("dist"):
		rig.dist = float(s["dist"])
	if s.has("pitch"):
		rig.pitch_deg = float(s["pitch"])
	if s.has("yaw"):
		rig.yaw_deg = float(s["yaw"])
	await _frames(int(s.get("frames", 6)))
	return _ok("camera dist %.0f pitch %.0f yaw %.0f" % [rig.dist, rig.pitch_deg, rig.yaw_deg])


## {do:view, pos:[x,y,z], at:[x,y,z], fov} puts a free camera at pos looking at `at` (map
## screenshots); {do:view, off:true} hands the view back to the game camera.
func _view(s: Dictionary) -> Dictionary:
	if scene == null:
		return _fail("no match")
	var cam := scene.get_node_or_null("PlaytestViewCam") as Camera3D
	if bool(s.get("off", false)):
		if cam != null:
			cam.queue_free()
		scene.hud.set("visible", true)
		await _frames(2)
		return _ok("game camera")
	if cam == null:
		cam = Camera3D.new()
		cam.name = "PlaytestViewCam"
		cam.far = 4000.0
		scene.add_child(cam)
	cam.fov = float(s.get("fov", 55.0))
	cam.current = true
	# Clean map shots: hide the HUD unless asked to keep it.
	scene.hud.set("visible", bool(s.get("hud", false)))
	var pos: Array = s.get("pos", [256, 200, 600])
	var at: Array = s.get("at", [256, 40, 256])
	cam.position = Vector3(pos[0], pos[1], pos[2])
	cam.look_at(Vector3(at[0], at[1], at[2]))
	await _frames(int(s.get("frames", 6)))
	return _ok("view from %s at %s" % [pos, at])


## {do:carve, at:[x,y,z], r} - client-only crater for looking at blast damage: carves a ball out
## of the local terrain copy and feeds it to the view as a terrain.patch (the sim never sees it).
func _carve(s: Dictionary) -> Dictionary:
	if scene == null or scene.terrain_view == null:
		return _fail("no terrain")
	var tv: Node3D = scene.terrain_view
	var store: RefCounted = tv.get("store")
	if store == null:
		return _fail("no terrain")
	var at: Array = s.get("at", [256, 40, 256])
	var r := int(s.get("r", 6))
	var c := Vector3i(int(at[0]), int(at[1]), int(at[2]))
	var lo := (c - Vector3i(r + 1, r + 1, r + 1)).max(Vector3i.ZERO)
	var hi := (c + Vector3i(r + 2, r + 2, r + 2)).min(Vector3i(int(store.get("size_x")), int(store.get("size_y")), int(store.get("size_z"))))
	var size := hi - lo
	var bytes := PackedByteArray()
	bytes.resize(size.x * size.y * size.z)
	var dens: PackedByteArray = store.get("density")
	var sx := int(store.get("size_x"))
	var sz := int(store.get("size_z"))
	var k := 0
	for y in range(lo.y, hi.y):
		for z in range(lo.z, hi.z):
			for x in range(lo.x, hi.x):
				var d := Vector3(x - c.x, y - c.y, z - c.z).length()
				var v: int = dens[(y * sz + z) * sx + x]
				bytes[k] = 0 if d <= r else v
				k += 1
	tv.call("apply_patch", {"x0": lo.x, "y0": lo.y, "z0": lo.z, "sx": size.x, "sy": size.y, "sz": size.z,
		"density": Codec.encode(bytes)})
	await _frames(int(s.get("frames", 20)))
	return _ok("carved r=%d at %s, decor broken %s" % [r, at, tv.get("decor").get("broken") if tv.get("decor") != null else 0])


## {do:menu, open: pause|settings|weapons|none}
func _menu(which: String) -> Dictionary:
	if scene == null:
		return _fail("no match")
	_close_screen()
	match which:
		"pause":
			scene.pause.open()
		"settings":
			scene.pause.open()
			scene.pause.call("_open_settings")
		"weapons":
			_send_key(int(GameSettings.keys["weapon_menu"]), true)
			_send_key(int(GameSettings.keys["weapon_menu"]), false)
		"none":
			if scene.pause.is_open():
				scene.pause.close()
			scene.hud.get("_weapon_grid").close()
		_:
			return _fail("open must be pause, settings, weapons or none")
	await _frames(4)
	return _ok()


## Fire at the nearest enemy on each of our turns; the rival does what `opponent` says on its turns.
func _play_turns(count: int, s: Dictionary) -> Dictionary:
	if scene == null:
		return _fail("no match")
	var played := 0
	var notes: Array[String] = []
	while played < count:
		if _snap()["phase"] == "over":
			notes.append("match over")
			break
		if not await _until(func() -> bool: return (_snap()["my_turn"] and _snap()["phase"] == "control") or _snap()["phase"] == "over", 120.0):
			return _fail("our turn never came back; " + ", ".join(notes))
		if _snap()["phase"] == "over":
			notes.append("match over")
			break
		var before := _hp_by_team(_snap())
		var shot := await _aim({"at": "nearest_enemy", "weapon": str(s.get("weapon", "acorn-mortar")), "flight_shot": false}, true)
		played += 1
		var after := _hp_by_team(_snap())
		notes.append("turn %d: %s, team hp %s -> %s" % [played, "fired" if shot["ok"] else shot.get("error", "?"), before, after])
		await _shot("%02d-turn-%d" % [step_no, played])
	return _ok(" | ".join(notes))


# ------------------------------------------------------------------ the rival client


func _process(dt: float) -> void:
	if b == null or scene == null or not scene.vm.started:
		return
	var v := _snap()
	if v["my_turn"] or v["phase"] != "control" or v["active_team"] == null:
		_b_wait = 0.0
		return
	var turn := int(v["turn"])
	if turn == _b_acted_turn:
		return
	_b_wait += dt
	if _b_wait < 1.0 or opponent == "idle":
		return
	_b_acted_turn = turn
	if opponent == "skip":
		b.send_input(turn, [{"k": "skip"}])
		return
	var me := _active(v)
	var to: Variant = null
	var best := INF
	for c: Dictionary in v["critters"]:
		if c["alive"] and vm_local(int(c["team"])):
			var d := (c["pos"] as Vector3).distance_to(me["pos"])
			if d < best:
				best = d
				to = c["pos"]
	if me.is_empty() or to == null:
		b.send_input(turn, [{"k": "skip"}])
		return
	var d3: Vector3 = (to as Vector3) - (me["pos"] as Vector3)
	var dist := Vector2(d3.x, d3.z).length()
	var pitch := 45
	var power := _power_for(dist, d3.y, pitch, 4.5)
	if power <= 0.0 or power > 100.0:
		pitch = 65
		power = clampf(_power_for(dist, d3.y, pitch, 4.5), 10.0, 100.0)
	var yaw := posmod(int(round(atan2(d3.z, d3.x) / TAU * 1024.0)), 1024)
	b.send_input(turn, [{"k": "fire", "weaponId": "acorn-mortar", "yaw": yaw, "pitch": pitch, "power": int(power)}])


func vm_local(team: int) -> bool:
	return scene.vm.local_teams.has(team)


# ------------------------------------------------------------------ interactive mode


func _serve_inbox() -> void:
	print("PLAYTEST READY inbox=", inbox_path)
	var f := FileAccess.open(out_dir.path_join("ready"), FileAccess.WRITE)
	f.store_string(str(step_no))
	f.close()
	var done_lines := 0
	var idle := 0.0
	while idle < idle_limit:
		var lines: PackedStringArray = []
		if FileAccess.file_exists(inbox_path):
			lines = FileAccess.get_file_as_string(inbox_path).split("\n", false)
		if lines.size() > done_lines:
			idle = 0.0
			for i in range(done_lines, lines.size()):
				var parsed: Variant = JSON.parse_string(lines[i])
				done_lines = i + 1
				if not parsed is Dictionary:
					parsed = {"do": "(not a JSON object)", "raw": lines[i].left(200), "shot": false}
				await _run_step(parsed)
				if str(parsed.get("do", "")) == "quit":
					return
		else:
			await _seconds(0.25)
			idle += 0.25
	print("PLAYTEST idle for %.0f s, stopping" % idle_limit)


# ------------------------------------------------------------------ state and report


func _snap() -> Dictionary:
	return scene.vm.snapshot()


func _active(v: Dictionary) -> Dictionary:
	if v.is_empty():
		return {}
	return _critter(v, int(v["active_critter_id"]) if v["active_critter_id"] != null else -1)


static func _critter(v: Dictionary, id: int) -> Dictionary:
	for c: Dictionary in v["critters"]:
		if int(c["id"]) == id:
			return c
	return {}


static func _hp_by_team(v: Dictionary) -> Dictionary:
	var out := {}
	for c: Dictionary in v["critters"]:
		var t := str(c["team"])
		out[t] = int(out.get(t, 0)) + (int(c["hp"]) if c["alive"] else 0)
	return out


func _state() -> Dictionary:
	var st := {"screen": screen.name if screen != null and is_instance_valid(screen) else "", "room": a.lobby.code(), "net_connected": a.connected}
	if scene == null or not scene.vm.started:
		return st
	var v := _snap()
	var hud: Node = scene.hud
	var c: Node = scene.controls
	var team := int(v["active_team"]) if v["my_turn"] else (int(scene.vm.local_teams[0]) if not scene.vm.local_teams.is_empty() else -1)
	var crit: Array = []
	for x: Dictionary in v["critters"]:
		var p: Vector3 = x["pos"]
		var e := {"id": x["id"], "team": x["team"], "hp": x["hp"], "alive": x["alive"], "pos": [snappedf(p.x, 0.1), snappedf(p.y, 0.1), snappedf(p.z, 0.1)], "grounded": x["grounded"]}
		for k in ["act", "shield", "frozen", "feather"]:
			if x.get(k) and str(x.get(k)) != "":
				e[k] = x[k]
		crit.append(e)
	var aim: Variant = c.aim
	st.merge({
		"mode": mode,
		"turn": v["turn"],
		"round": v["round"],
		"phase": v["phase"],
		"time_left": snappedf(float(v["time_left"]), 0.1),
		"my_turn": v["my_turn"],
		"active_critter": v["active_critter_id"],
		"active_team": v["active_team"],
		"local_teams": v["local_teams"],
		"winner_team": v["winner_team"],
		"wind": [v["wind"].x, v["wind"].y],
		"team_hp": _hp_by_team(v),
		"critters": crit,
		"projectiles": (v["projectiles"] as Array).map(func(p: Dictionary) -> String: return str(p["weapon"])),
		"mines": (v["mines"] as Array).size(),
		"crates": (v["crates"] as Array).size(),
		"zones": (v["zones"] as Array).size(),
		"weapon": c.weapon_id(),
		"weapon_label": c.weapon_name(),
		"ammo_left": scene.vm.ammo_left(team, c.weapon_id()),
		"aiming": null if aim == null else {"yaw": aim.yaw, "pitch": aim.pitch_deg, "power": snappedf(aim.power, 1)},
		"banner": hud.get("_banner_label").text,
		"hint": hud.get("_hint").text,
		"tutorial": scene.get("_guide_label").text if scene.get("_guide_label") != null else "",
		"menus": {"pause": scene.pause.is_open(), "weapons": hud.get("_weapon_grid").visible},
		"camera": {"dist": snappedf(scene._rig.dist, 1), "pitch": snappedf(scene._rig.pitch_deg, 1), "yaw": snappedf(scene._rig.yaw_deg, 1)},
	})
	return st


func _row_md(r: Dictionary) -> String:
	var st: Dictionary = r["state"]
	var summary := ""
	if st.has("turn"):
		summary = "turn %s %s %ss, %s, hp %s, %s" % [st["turn"], st["phase"], st["time_left"], "our turn" if st["my_turn"] else "their turn", JSON.stringify(st["team_hp"]), st["weapon"]]
	var shot := "" if r["shot"] == "" else "[%s](shots/%s)" % [str(r["shot"]).get_file(), str(r["shot"]).get_file()]
	var detail := "%s %s" % [r["note"], r["error"]]
	return "| %d | %s | %s | %s | %s | %s |" % [r["step"], JSON.stringify(r["args"]).replace("|", "/"), "ok" if r["ok"] else "**FAIL**", detail.strip_edges().replace("|", "/"), summary, shot]


func _write_report() -> void:
	var f := FileAccess.open(out_dir.path_join("report.md"), FileAccess.WRITE)
	f.store_line("# Playtest report")
	f.store_line("")
	f.store_line("Scenario: `%s`. Server: `%s`. Steps: %d, failed: %d. Screenshots: %s." % [scenario_path, NetConfig.server_base(), step_no, failures, "yes" if shots_on else "no (headless)"])
	f.store_line("Full state per step is in `steps.jsonl`. Engine errors, if any, are appended below by tools/playtest/pt.sh.")
	f.store_line("")
	f.store_line("| # | step | result | notes | state after | shot |")
	f.store_line("| - | - | - | - | - | - |")
	for r in _rows:
		f.store_line(r)
	f.close()


# ------------------------------------------------------------------ helpers


func _watch_net(n: Node) -> void:
	n.enter_failed.connect(func(m: String) -> void: _errors.append("%s enter_failed: %s" % [n.name, m]))
	n.server_error.connect(func(code: String, m: String) -> void: _errors.append("%s server_error %s: %s" % [n.name, code, m]))
	n.disconnected.connect(func(m: String) -> void: _errors.append("%s disconnected: %s" % [n.name, m]))


func _note_events(msg: Dictionary) -> void:
	for e: Dictionary in msg.get("events", []):
		var t := str(e.get("type", ""))
		if t == "explosion":
			var edit: Dictionary = e.get("edit", {})
			_blasts.append(Vector3(float(edit.get("x", 0)), float(edit.get("y", 0)), float(edit.get("z", 0))))
		if t == "damage":
			t = "damage:%d:%d" % [int(e.get("critterId", -1)), int(e.get("amount", 0))]
		_events.append(t)


func _until(cond: Callable, timeout := STEP_TIMEOUT) -> bool:
	var deadline := Time.get_ticks_msec() + int(timeout * 1000.0)
	while not cond.call():
		if Time.get_ticks_msec() > deadline:
			return false
		await get_tree().process_frame
	return true


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _seconds(s: float) -> void:
	await get_tree().create_timer(s, true, false, true).timeout


func _shot(shot_name: String) -> String:
	if not shots_on:
		return ""
	await _frames(3)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := out_dir.path_join("shots").path_join(shot_name + ".png")
	if img == null or img.save_png(path) != OK:
		_errors.append("could not save " + path)
		return ""
	return path
