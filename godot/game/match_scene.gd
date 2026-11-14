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
## Aiming is first person: the camera sits at the head. Below this rig distance the body is hidden.
const FIRST_PERSON_BACK := 6.0
const FIRST_PERSON_DIST := 12.0
const HINT_WATCH := "Watching. Hold tight."
const HINT_EMPTY := "Out of ammo for this one. Pick another weapon."

var vm := ViewModel.new()
var controls := Controls.new()
var hud: Hud
var camera: Camera3D
var env: MatchEnvironment
var fx: MatchEffects
var shots: ShotViews
var crates: CrateViews
var gear: GearFx
## critter id -> the weapon it last fired, so a melee `punch` knows which swing it was.
var _swing: Dictionary = {}
var zones: ZoneViews
var pause: PauseMenu
var terrain_view: Node3D = null

var _critters: Dictionary = {}  # id -> Node3D
var _rig := CameraMath.RigState.new()
var _blast_at := Vector3.ZERO
var _blast_left := 0.0
var _marker: MeshInstance3D
var _target_ring: MeshInstance3D
var _time := 0.0
var _last_turn := -1
var _ammo_hash := -1
var _crates_seen := false
## Set for a practice match (config.practice): the guided prompts and the label that shows them.
var _guide: PracticeGuide = null
var _guide_label: Label = null
var _guide_layer: CanvasLayer = null
var _spot: TutorialSpotlight = null
var _done_panel: PanelContainer = null
var _done_shown := false
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
	shots.lost.connect(_on_shot_lost)
	add_child(shots)
	crates = CrateViews.new()
	gear = GearFx.new()
	gear.name = "Gear"
	add_child(gear)
	zones = ZoneViews.new()
	zones.name = "Zones"
	add_child(zones)
	crates.name = "Crates"
	crates.landed.connect(func(at: Vector3) -> void: fx.dust(at, 2.4))
	add_child(crates)
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
		hud.connect("weapon_picked", func(i: int) -> void: controls.weapon = clampi(i, 0, controls.weapons.size() - 1))
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
	gear.clear()
	zones.clear()
	crates.clear()
	_crates_seen = false
	vm.set_teams(_teams_from_net(msg.get("teamIds", [])))
	vm.set_local_teams(_local_teams_from_net(msg.get("teamIds", [])))
	vm.apply_match_start(msg)
	# The server lists the weapons; nothing about the arsenal is hardcoded on this side.
	var catalog: Array = msg.get("weapons", [])
	if not catalog.is_empty():
		controls.set_catalog(catalog)
		hud.set_catalog(catalog)
	var t: Dictionary = msg.get("terrain", {})
	_world = Vector2(float(t.get("sizeX", 256)), float(t.get("sizeZ", 256)))
	if terrain_view == null and ResourceLoader.exists(TERRAIN_SCRIPT):
		var script: Script = load(TERRAIN_SCRIPT)
		var node := Node3D.new()
		node.set_script(script)
		set_terrain_view(node)
	_setup_guide(bool((msg.get("config", {}) as Dictionary).get("practice", false)))
	var look := MapLook.for_theme(MapLook.theme_of(msg))
	if terrain_view != null and terrain_view.has_method("load_terrain"):
		terrain_view.call("load_terrain", t)
		var ground_mat := terrain_view.get("material") as ShaderMaterial
		if ground_mat != null:
			MapLook.paint_terrain(ground_mat, look)
	fx.debris_color = MapLook.color(look, "debris")
	env.setup(_world.x, _world.y, vm.sea_y, Callable(self, "ground_y"), look)
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
		# Pause closes an open weapon grid first, so the two never show together.
		if not pause.is_open() and hud.close_grid():
			return
		pause.toggle()
		return
	if not pause.is_open():
		controls.handle_event(ev)


## Walk and aim hints use whatever keys the player has bound.
func _hint_walk() -> String:
	var walk := ""
	for id in ["move_forward", "move_left", "move_back", "move_right"]:
		walk += GameSettings.key_label(int(GameSettings.keys.get(id, 0)))
	return walk + " walk - " + GameSettings.hint_for(
		[["jump", "jump"], ["backflip", "backflip"], ["toggle_aim", "aim"], ["skip", "skip"]]
	)


func _guide_keys() -> Dictionary:
	var walk := ""
	for id in ["move_forward", "move_left", "move_back", "move_right"]:
		walk += GameSettings.key_label(int(GameSettings.keys.get(id, 0)))
	return {
		"walk": walk,
		"jump": GameSettings.key_label(int(GameSettings.keys.get("jump", 0))),
		"aim": GameSettings.key_label(int(GameSettings.keys.get("toggle_aim", 0))),
		"fire": GameSettings.key_label(int(GameSettings.keys.get("fire", 0))),
		"weapon_menu": GameSettings.key_label(int(GameSettings.keys.get("weapon_menu", 0))),
	}


## Practice matches get the tutorial: a prompt banner under the turn banner, a yellow frame that
## points at the HUD piece a step is about, and a "Tutorial complete" card at the end.
func _setup_guide(practice: bool) -> void:
	if _guide_layer != null:
		_guide_layer.queue_free()
	_guide_layer = null
	_guide_label = null
	_spot = null
	_done_panel = null
	_done_shown = false
	_guide = null
	if not practice:
		return
	_guide = PracticeGuide.new()
	var layer := CanvasLayer.new()
	layer.name = "PracticeGuide"
	layer.layer = 5
	add_child(layer)
	_guide_layer = layer
	var panel := PanelContainer.new()
	panel.theme = MenuStyle.theme()
	panel.set_anchors_preset(Control.PRESET_CENTER_TOP)
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	panel.offset_top = 104.0
	layer.add_child(panel)
	_guide_label = Label.new()
	_guide_label.add_theme_font_size_override("font_size", 22)
	_guide_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	# Long prompts wrap inside a capped width instead of running off the screen.
	_guide_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_guide_label.custom_minimum_size.x = minf(860.0, get_viewport().get_visible_rect().size.x - 80.0)
	panel.add_child(_guide_label)
	_spot = TutorialSpotlight.new()
	layer.add_child(_spot)
	_build_done_card(layer)


func _build_done_card(layer: CanvasLayer) -> void:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(center)
	_done_panel = PanelContainer.new()
	_done_panel.theme = MenuStyle.theme()
	_done_panel.custom_minimum_size = Vector2(440, 0)
	_done_panel.visible = false
	center.add_child(_done_panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	_done_panel.add_child(box)
	var head := Label.new()
	head.text = "Tutorial complete"
	head.label_settings = MenuStyle.heading(34, Color("ffd23f"), 10)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(head)
	var body := Label.new()
	body.text = "You have walked, jumped, aimed, fired, switched weapons, taken a crate and knocked a dummy into the soda sea. Keep playing, or go back to the title screen."
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.custom_minimum_size = Vector2(400, 60)
	box.add_child(body)
	var keep := Button.new()
	keep.text = "Keep playing"
	MenuStyle.paint(keep, MenuStyle.GREEN, 20)
	keep.pressed.connect(func() -> void: _done_panel.visible = false)
	box.add_child(keep)
	var back := Button.new()
	back.text = "Back to title"
	MenuStyle.paint(back, MenuStyle.ORANGE, 20)
	back.pressed.connect(_leave)
	box.add_child(back)


## Frame the HUD piece the current step is about, hide the frame while the pause menu is up, and
## show the done card once when the tutorial ends.
func _update_tutorial_pointers() -> void:
	var target: Control = null
	if not pause.is_open() and not _guide.finished():
		target = hud.highlight_target(_guide.highlight())
	_spot.point_at(target)
	if _guide.finished() and not _done_shown and _done_panel != null:
		_done_shown = true
		_done_panel.visible = true


## True while one of the local player's shots that can be steered (robot, racer, kite, marble) is out.
func _steering(v: Dictionary) -> bool:
	for p: Dictionary in v["projectiles"]:
		if ShotModels.STEERED.has(str(p["weapon"])):
			return true
	return false


func _hint_steer() -> String:
	var walk := ""
	for id in ["move_forward", "move_left", "move_back", "move_right"]:
		walk += GameSettings.key_label(int(GameSettings.keys.get(id, 0)))
	return walk + " steer - " + GameSettings.hint_for([["trigger", "detonate"]])


func _hint_aim() -> String:
	return "Move the mouse to aim - " + GameSettings.hint_for([["fire", "(hold) charge, release to fire"], ["cancel_aim", "cancel"]])


func _process(dt: float) -> void:
	if not _built:
		return
	_time += dt
	vm.advance(dt)
	var v := vm.snapshot()

	controls.enabled = bool(v["my_turn"]) and v["phase"] != "over"
	# The team whose ammo the HUD shows: the one playing if it is ours, else our first team.
	var ammo_team := -1
	if v["my_turn"]:
		ammo_team = int(v["active_team"])
	elif not vm.local_teams.is_empty():
		ammo_team = int(vm.local_teams[0])
	var left := vm.team_ammo(ammo_team)
	if left.hash() != _ammo_hash:
		_ammo_hash = left.hash()
		hud.set_team_ammo(left)
	var empty := bool(v["my_turn"]) and vm.ammo_left(ammo_team, controls.weapon_id()) == 0
	if empty and v["phase"] == "control":
		# A spent weapon (the one-shot jetpack, say) falls back to the first one with ammo left.
		for w: Dictionary in controls.weapons:
			if vm.ammo_left(ammo_team, str(w["id"])) != 0:
				controls.select_id(str(w["id"]))
				empty = false
				break
	controls.can_fire = controls.enabled and v["phase"] == "control" and not empty
	controls.paused = pause.is_open()
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

	var events := vm.take_events()
	_handle_events(events, v)
	if _guide != null and _guide_label != null:
		_guide.feed(v, aim != null, events, controls.weapon_id())
		_guide_label.text = _guide.text(_guide_keys())
		_guide_label.visible = v["phase"] != "over" and not pause.is_open()
		_update_tutorial_pointers()
	_sync_critters(v, active, aim, dt)
	shots.sync(v["projectiles"], v["mines"])
	gear.sync(v["critters"], dt)
	zones.sync(v["zones"], dt)
	crates.sync(v["crates"], dt, _crates_seen)
	_crates_seen = true
	_update_marker(v, active, aim)
	_update_camera(v, active, aim, mouse, dt)

	env.set_sea_y(vm.sea_y)
	env.update(dt, v["wind"])
	var hint := HINT_WATCH
	if v["my_turn"] and _steering(v):
		hint = _hint_steer()
	elif v["my_turn"] and v["phase"] != "settling":
		hint = _hint_aim() if aim != null else _hint_walk()
		if empty and v["phase"] == "control":
			hint = HINT_EMPTY
	hud.update(v, aim, "" if v["phase"] == "over" else hint, controls.weapon_name(), _world)


func _send_input(turn: int, cmds: Array) -> void:
	var msg := {"turn": turn, "cmds": cmds}
	input_ready.emit(msg)
	var net := get_node_or_null("/root/Net")
	if net != null and net.has_method("send_input"):
		net.call("send_input", turn, cmds)


## A shot that vanished at the soda line splashes; ones that blew up on land already had their blast.
func _on_shot_lost(at: Vector3, weapon: String) -> void:
	if at.y <= vm.sea_y + 2.0:
		fx.splash(Vector3(at.x, vm.sea_y, at.z), 3.0)
	elif weapon == "pinecone-popper":
		fx.burst(at, Color("8b5a2b"))


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
			if str(e.get("cause", "")) == "water" and not c.is_empty():
				fx.splash(Vector3((c["pos"] as Vector3).x, vm.sea_y, (c["pos"] as Vector3).z), 5.0)
			var hit: SquirmlingRig = _critters.get(int(e.get("critterId", -1)), null)
			if hit != null:
				hit.hurt()
		elif kind == "crateTaken":
			var taker := _find(v["critters"], int(e.get("critterId", -1)))
			if not taker.is_empty():
				var what := "+%d" % int(e.get("amount", 0))
				if str(e.get("kind", "")) == "weapon":
					what = "+1 %s" % hud.weapon_title(str(e.get("weaponId", "")))
				fx.pickup((taker["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT, 0), what)
		elif kind == "tracer":
			fx.tracer(
				ViewModel.point(e.get("from", {})),
				ViewModel.point(e.get("to", {})),
				bool(e.get("hit", false)),
				str(e.get("weaponId", ""))
			)
		elif kind == "mineTriggered":
			for p in (v["projectiles"] as Array) + (v["mines"] as Array):
				if int(p["id"]) == int(e.get("projectileId", -1)):
					fx.puff(p["pos"], 2.5)
		elif kind == "punch":
			var struck: Variant = e.get("hits", 0)
			fx.melee(
				ViewModel.point(e.get("at", {})),
				(struck as Array).size() if struck is Array else int(struck),
				str(_swing.get(int(e.get("critterId", -1)), ""))
			)
		elif kind == "teleported":
			var up := Vector3(0, CRITTER_MODEL.HEIGHT * 0.5, 0)
			fx.teleport(ViewModel.point(e.get("from", {})) + up, ViewModel.point(e.get("to", {})) + up)
		elif kind == "shieldPopped":
			var popped := _find(v["critters"], int(e.get("critterId", -1)))
			if not popped.is_empty():
				fx.burst((popped["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT * 0.5, 0), Color("8fd8ff"))
		elif kind == "frozen" or kind == "thawed":
			var iced := _find(v["critters"], int(e.get("critterId", -1)))
			if not iced.is_empty():
				var mid := (iced["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT * 0.5, 0)
				fx.burst(mid, Color("bfe9ff"))
		elif kind == "healed":
			var healed := _find(v["critters"], int(e.get("critterId", -1)))
			if not healed.is_empty():
				var top := (healed["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT, 0)
				fx.heal(top, int(e.get("amount", 0)))
		elif kind == "fired":
			_swing[int(e.get("critterId", -1))] = str(e.get("weaponId", ""))
			var shooter: SquirmlingRig = _critters.get(int(e.get("critterId", -1)), null)
			if shooter != null:
				shooter.fire()
			if str(e.get("weaponId", "")) == "tabletop-quake":
				var thumper := _find(v["critters"], int(e.get("critterId", -1)))
				if not thumper.is_empty():
					fx.quake(thumper["pos"])


func _sync_critters(v: Dictionary, active: Dictionary, aim: CameraMath.AimState, dt: float) -> void:
	var seen := {}
	for c in v["critters"]:
		var id: int = c["id"]
		seen[id] = true
		var node: SquirmlingRig = _critters.get(id, null)
		if node == null:
			var look: Dictionary = _look(int(c["team"]))
			node = CRITTER_MODEL.create(int(c["team"]), str(look["hat"]), look["color"])
			node.set_seed(id)
			_critters[id] = node
			add_child(node)
		node.set_alive(c["alive"])
		var pos: Vector3 = c["pos"]
		# Speed from the change in the (already smoothed) position. A respawn or a teleport must not
		# read as a huge shove, so it is capped.
		var vel := Vector3.ZERO
		if _prev_pos.has(id) and dt > 0.0:
			vel = ((pos - (_prev_pos[id] as Vector3)) / dt).limit_length(60.0)
		_prev_pos[id] = pos
		node.position = pos
		node.rotation.y = deg_to_rad(float(c["heading_deg"]))
		var is_active: bool = not active.is_empty() and active["id"] == id
		var pitch := float(aim.pitch_deg) if is_active and aim != null else 0.0
		node.drive(dt, is_active, vel, bool(c.get("grounded", true)), pitch)
		var team_color: Color = _look(int(c["team"]))["color"]
		var hp_frac := float(c["hp"]) / maxf(1.0, float(c["max_hp"]))
		CRITTER_MODEL.set_tag(node, str(c["name"]), team_color.lightened(0.35), hp_frac)
		node.set_first_person(is_active and aim != null and _rig.dist < FIRST_PERSON_DIST)
		var head := pos + Vector3(0, CRITTER_MODEL.HEIGHT, 0)
		node.update_tag(
			camera.global_position, _hidden_by_terrain(camera.global_position, head), get_viewport().get_visible_rect().size.y, camera.fov
		)
	for id in _critters.keys():
		if not seen.has(id):
			(_critters[id] as Node).queue_free()
			_critters.erase(id)
			_prev_pos.erase(id)


## True when the ground rises between `from` and `to` (a camera and a critter's head). Samples
## the line, ignoring the last stretch next to the head so a critter standing on a slope is not
## hidden by its own hill.
func _hidden_by_terrain(from: Vector3, to: Vector3) -> bool:
	if from.distance_to(to) > 260.0:
		return false
	for i in range(1, 11):
		var p := from.lerp(to, float(i) / 12.0)
		if p.x < 0.0 or p.z < 0.0 or p.x >= _world.x or p.z >= _world.y:
			continue
		if p.y < ground_y(p.x, p.z):
			return true
	return false


func _update_camera(v: Dictionary, active: Dictionary, aim: CameraMath.AimState, mouse: Dictionary, dt: float) -> void:
	if aim == null:
		_rig = CameraMath.drag_orbit(_rig, float(mouse["dx"]), float(mouse["dy"]))
	_rig = CameraMath.zoom(_rig, float(mouse["wheel"]))
	_blast_left = maxf(0.0, _blast_left - dt)
	var goal: Dictionary
	# A mine lying in wait is not a shot to follow.
	var shot_list: Array = (v["projectiles"] as Array).filter(
		func(p: Dictionary) -> bool: return str(p["weapon"]) != "jelly-mine"
	)
	if not shot_list.is_empty():
		goal = {"mode": "follow", "target": shot_list[0]["pos"], "dist": 38.0}
	elif _blast_left > 0.0:
		goal = {"mode": "follow", "target": _blast_at, "dist": 42.0}
	elif aim != null and not active.is_empty():
		# First person: the camera sits at the head (target is a little way along the aim, and the
		# camera is `dist` back from it). The rig eases in from the orbit view and back out again.
		var cam_pitch := float(aim.pitch_deg) * CameraMath.FIRST_PERSON_PITCH_SHARE
		var d := CameraMath.offset_dir(CameraMath.yaw_to_deg(aim.yaw), cam_pitch)
		var p: Vector3 = active["pos"]
		goal = {
			"mode": "aim",
			"target": p + Vector3(0, CRITTER_MODEL.HEIGHT * 0.86, 0) + d * FIRST_PERSON_BACK,
			"yaw_deg": CameraMath.camera_yaw_for_heading(CameraMath.yaw_to_deg(aim.yaw)),
			"pitch_deg": -cam_pitch,
			"dist": FIRST_PERSON_BACK,
		}
	else:
		var tgt := _rig.target
		if not active.is_empty():
			tgt = (active["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT * 0.6, 0)
		if v["phase"] == "over" and v["winner_team"] != null:
			# The match is won: look at a survivor of the winning team, not at the empty sea.
			for c: Dictionary in v["critters"]:
				if bool(c["alive"]) and int(c["team"]) == int(v["winner_team"]):
					tgt = (c["pos"] as Vector3) + Vector3(0, CRITTER_MODEL.HEIGHT * 0.6, 0)
					break
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
	fx.listener = camera.position
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
	# Where an air strike or a placed item will land.
	_target_ring = MeshInstance3D.new()
	_target_ring.name = "TargetRing"
	var ring := TorusMesh.new()
	ring.inner_radius = 3.2
	ring.outer_radius = 4.0
	_target_ring.mesh = ring
	var ring_mat := StandardMaterial3D.new()
	ring_mat.albedo_color = Color("ff5a3d")
	ring_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ring_mat.no_depth_test = true
	_target_ring.material_override = ring_mat
	_target_ring.visible = false
	add_child(_target_ring)
	add_child(_marker)


## The spot under the crosshair, found by walking along the view ray until it dips under the
## ground. Null on the sky or the open sea.
func _pick_ground(aim: CameraMath.AimState = null) -> Variant:
	var from := camera.global_position
	var dir := -camera.global_transform.basis.z
	if aim != null:
		# The camera is tipped less than the aim (first person), so follow the aim itself.
		dir = CameraMath.aim_direction(aim)
	var step := 1.0
	var p := from
	for i in range(700):
		p += dir * step
		if p.x < 0.0 or p.z < 0.0 or p.x >= _world.x or p.z >= _world.y:
			if i > 40 and p.y < vm.sea_y:
				return null
			continue
		var g := ground_y(p.x, p.z)
		if p.y <= g:
			return Vector3(p.x, g, p.z) if g > vm.sea_y else null
		if p.y < vm.sea_y:
			return null
	return null


func _update_marker(v: Dictionary, active: Dictionary, aim: CameraMath.AimState) -> void:
	var targeting := aim != null and controls.needs("target")
	controls.target = _pick_ground(aim) if targeting else null
	_target_ring.visible = controls.target != null
	if _target_ring.visible:
		_target_ring.position = (controls.target as Vector3) + Vector3(0, 0.6, 0)
		_target_ring.scale = Vector3.ONE * (1.0 + 0.12 * sin(_time * 6.0))
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
