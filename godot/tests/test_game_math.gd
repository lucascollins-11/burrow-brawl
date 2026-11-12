extends TestCase


func test_yaw_and_heading_round_trip_and_match_the_wire() -> void:
	check_eq(CameraMath.yaw_to_deg(0), 90.0, "yaw 0 is +x, heading 90")
	check_eq(CameraMath.yaw_to_deg(256), 0.0, "yaw 256 is +z, heading 0")
	for yaw in [0, 100, 256, 511, 1023]:
		check_eq(CameraMath.deg_to_yaw(CameraMath.yaw_to_deg(yaw)), yaw, "round trip %d" % yaw)


func test_move_relative_to_camera() -> void:
	check_eq(CameraMath.move_relative_to_camera(0.0, 0, 0), Vector3.ZERO, "idle")
	var fwd := CameraMath.move_relative_to_camera(0.0, 1, 0)
	check(fwd.distance_to(Vector3(0, 0, -1)) < 0.001, "camera yaw 0 looks along -z")
	var diag := CameraMath.move_relative_to_camera(0.0, 1, 1)
	check(absf(diag.length() - 1.0) < 0.001, "diagonal is a unit vector")


func test_aim_charge_and_nudge_stay_whole_and_clamped() -> void:
	var a := CameraMath.new_aim(90.0)
	check_eq(a.yaw, 0, "heading 90 is wire yaw 0")
	a.charging = true
	for i in range(300):
		a = CameraMath.charge_aim(a, 0.1)
	check(a.power <= 100.0 and a.power > 0.0, "power stays within 0..100")
	var n := CameraMath.nudge_aim(a, 0.0, -1000.0)
	check(n.pitch_deg <= CameraMath.AIM_MAX_PITCH, "pitch is clamped")


func test_step_rig_converges_toward_the_goal() -> void:
	var r := CameraMath.RigState.new()
	var goal := {"mode": "follow", "target": Vector3(10, 20, 30), "dist": 40.0}
	for i in range(120):
		r = CameraMath.step_rig(r, goal, 1.0 / 60.0)
	check(r.target.distance_to(Vector3(10, 20, 30)) < 1.0, "target reaches the goal")
	check(absf(r.dist - 40.0) < 1.0, "distance reaches the goal")


func test_view_model_interpolates_between_two_states_in_voxels() -> void:
	var vm := ViewModel.new()
	var one := 65536
	(
		vm
		. apply_match_start(
			{
				"matchId": "m",
				"config": {"startHealth": 100},
				"teamIds": ["a", "b"],
				"terrain": {},
				"state":
				{
					"tick": 0,
					"turns": {"phase": "control", "activeTeam": 0, "activeCritter": 1},
					"seaY": 5,
					"critters":
					[
						{
							"id": 1,
							"team": 0,
							"x": 10 * one,
							"y": 20 * one,
							"z": 30 * one,
							"yaw": 0,
							"hp": 100
						}
					],
					"projectiles": [],
				},
			}
		)
	)
	(
		vm
		. apply_state(
			{
				"tick": 12,
				"turns": {"phase": "control", "activeTeam": 0, "activeCritter": 1},
				"seaY": 5,
				"critters":
				[
					{
						"id": 1,
						"team": 0,
						"x": 14 * one,
						"y": 20 * one,
						"z": 30 * one,
						"yaw": 0,
						"hp": 90
					}
				],
				"projectiles": [],
			}
		)
	)
	vm.advance(0.0)
	var s := vm.snapshot()
	var c: Dictionary = s["critters"][0]
	check(c["pos"].x >= 10.0 and c["pos"].x <= 14.0, "position is between the two samples")
	check_eq(c["hp"], 90, "latest hp")
	check_eq(s["sea_y"], 5.0, "sea level in voxels")
	for i in range(60):
		vm.advance(1.0 / 60.0)
	c = vm.snapshot()["critters"][0]
	check(absf(c["pos"].x - 14.0) < 0.001, "the render clock catches up to the newest state")


func test_view_model_drops_projectiles_missing_from_a_state() -> void:
	var vm := ViewModel.new()
	vm.apply_state(
		{"tick": 3, "projectiles": [{"id": 7, "x": 0, "y": 0, "z": 0, "weaponId": "acorn-mortar"}]}
	)
	check_eq(vm.snapshot()["projectiles"].size(), 1, "one shot")
	vm.apply_state({"tick": 6, "projectiles": []})
	check_eq(vm.snapshot()["projectiles"].size(), 0, "shot removed")


func test_hud_model_helpers() -> void:
	check_eq(HudModel.compass(0.0), "N", "north")
	check_eq(HudModel.compass(90.0), "E", "east")
	var calm := HudModel.wind_streamer(Vector2.ZERO)
	check_eq(calm["strength"], 0.0, "no wind")
	var gale := HudModel.wind_streamer(Vector2(500, 0))
	check_eq(gale["strength"], 1.0, "strength caps at 1")


func test_controls_send_only_changes_and_queued_commands() -> void:
	var c := Controls.new()
	check_eq(c.read_cmds().size(), 0, "standing still sends nothing")
	c.skip()
	var cmds := c.read_cmds()
	check_eq(cmds.size(), 1, "skip is queued once")
	check_eq(cmds[0]["k"], "skip", "skip command")
	c.free()


func test_fire_command_carries_integers_and_the_fuse_for_grenades() -> void:
	var c := Controls.new()
	var a := CameraMath.new_aim(0.0)
	a.power = 61.4
	var shell := c.fire_cmd(a)
	check_eq(shell["weaponId"], "acorn-mortar", "default weapon")
	check_eq(shell["power"], 61, "power rounded")
	check(not shell.has("fuseSeconds"), "no fuse on the mortar")
	c.weapon = 1
	check(c.fire_cmd(a).has("fuseSeconds"), "grenade has a fuse")
	c.free()


func test_squirmling_is_five_rings_with_a_head_and_tail_tuft() -> void:
	var s := Squirmling.create(0, "miner", Color.RED)
	for i in range(Squirmling.RING_COUNT):
		check(s.find_child("Ring%d" % i, true, false) != null, "ring %d exists" % i)
	check(s.find_child("TailTuft", true, false) != null, "tail tuft")
	check(s.find_child("Hat", true, false) != null, "hat")
	Squirmling.animate(s, 1.0, true, true)
	s.free()


func _ring_y(s: Node, i: int) -> float:
	return (s.find_child("Ring%d" % i, true, false) as Node3D).position.y


func test_squirmling_squashes_when_hit_and_settles_again() -> void:
	var s := Squirmling.create(0, "cone", Color.RED)
	for i in range(30):
		s.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	var rest := _ring_y(s, 4)
	s.hurt()
	var lowest := rest
	for i in range(20):
		s.drive(1.0 / 60.0, false, Vector3.ZERO, true)
		lowest = minf(lowest, _ring_y(s, 4))
	check(lowest < rest - 0.05, "the head dips when hit (%.3f vs %.3f)" % [lowest, rest])
	check((s.find_child("MouthOpen", true, false) as Node3D).visible, "the mouth opens while hurt")
	for i in range(240):
		s.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	check(absf(_ring_y(s, 4) - rest) < 0.15, "and it settles back")
	check(not (s.find_child("MouthOpen", true, false) as Node3D).visible, "the mouth closes again")
	s.free()


func test_squirmling_head_trails_behind_when_walking() -> void:
	var s := Squirmling.create(0, "cone", Color.RED)
	for i in range(60):
		s.drive(1.0 / 60.0, true, Vector3(0, 0, 8.0), true)
	var head := s.find_child("Ring4", true, false) as Node3D
	var tail := s.find_child("Ring0", true, false) as Node3D
	check(head.position.z < tail.position.z - 0.02, "the head lags behind the tail in the walk direction")
	s.free()


func test_squirmling_pops_apart_and_leaves_a_marker() -> void:
	var s := Squirmling.create(0, "cone", Color.RED)
	s.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	s.set_alive(false)
	check(s.pop_time >= 0.0, "the rings start flying")
	for i in range(200):
		s.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	check(s.pop_time < 0.0, "the pop ends")
	check((s.get_node("Marker") as Node3D).visible, "the marker is left behind")
	check(not (s.get_node("Model") as Node3D).visible, "the body is gone")
	s.set_alive(true)
	check((s.get_node("Model") as Node3D).visible and not (s.get_node("Marker") as Node3D).visible, "a revived Squirmling stands again")
	var late := Squirmling.create(0, "cone", Color.RED)
	late.set_alive(false)
	check(late.pop_time < 0.0 and (late.get_node("Marker") as Node3D).visible, "first seen knocked out: marker straight away")
	late.free()
	s.free()


func test_standings_put_the_winner_first_then_survivors_by_health() -> void:
	var teams: Array = []
	for i in range(3):
		teams.append({"index": i, "name": "T%d" % i, "color": Color.WHITE})
	var crit: Array = [
		{"id": 1, "team": 0, "hp": 0, "max_hp": 100, "alive": false},
		{"id": 2, "team": 1, "hp": 30, "max_hp": 100, "alive": true},
		{"id": 3, "team": 2, "hp": 80, "max_hp": 100, "alive": true},
	]
	var v := {"teams": teams, "critters": crit, "active_team": null, "phase": "over", "winner_team": 1}
	var rows := HudModel.standings(v)
	check_eq(rows[0]["index"], 1, "the winner is first")
	check_eq(rows[1]["index"], 2, "then the healthier survivor")
	check_eq(rows[2]["index"], 0, "the eliminated team is last")
	check_eq(rows[0]["rank"], 1, "rank starts at 1")
	check(rows[0]["winner"] and not rows[1]["winner"], "only one winner")


func test_map_look_follows_the_theme_and_falls_back() -> void:
	var msg := {"config": {"map": {"theme": "toybox-harbor"}}}
	check_eq(MapLook.theme_of(msg), "toybox-harbor", "the theme comes from config.map.theme")
	check_eq(MapLook.theme_of({}), MapLook.DEFAULT, "no theme: the default look")
	check_eq(MapLook.theme_of({"config": {"map": {"theme": "not-yet-made"}}}), MapLook.DEFAULT, "unknown theme: the default look")
	var base: Dictionary = MapLook.LOOKS[MapLook.DEFAULT]
	for id: String in MapLook.LOOKS:
		for key: String in base:
			check((MapLook.LOOKS[id] as Dictionary).has(key), "%s has %s" % [id, key])
	check(MapLook.color(MapLook.for_theme("toybox-harbor"), "grass") != MapLook.color(base, "grass"), "themes differ")


func test_view_model_keeps_ammo_per_team() -> void:
	var vm := ViewModel.new()
	check_eq(vm.ammo_left(0, "fizz-grenade"), -1, "an older server sends no ammo: unlimited")
	vm.apply_state({"tick": 1, "ammo": [{"fizz-grenade": 4}, {"fizz-grenade": 0}]})
	check_eq(vm.ammo_left(0, "fizz-grenade"), 4, "team 0 has four")
	check_eq(vm.ammo_left(1, "fizz-grenade"), 0, "team 1 is out")
	check_eq(vm.ammo_left(0, "acorn-mortar"), -1, "not listed means unlimited")
	check_eq(vm.ammo_left(5, "fizz-grenade"), -1, "no such team: nothing to limit")
	vm.apply_state({"tick": 2})
	check_eq(vm.ammo_left(0, "fizz-grenade"), 4, "a state without ammo keeps the last table")
