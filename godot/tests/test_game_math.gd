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
	vm.apply_match_start(
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
				"critters": [{"id": 1, "team": 0, "x": 10 * one, "y": 20 * one, "z": 30 * one, "yaw": 0, "hp": 100}],
				"projectiles": [],
			},
		}
	)
	vm.apply_state(
		{
			"tick": 12,
			"turns": {"phase": "control", "activeTeam": 0, "activeCritter": 1},
			"seaY": 5,
			"critters": [{"id": 1, "team": 0, "x": 14 * one, "y": 20 * one, "z": 30 * one, "yaw": 0, "hp": 90}],
			"projectiles": [],
		}
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
	vm.apply_state({"tick": 3, "projectiles": [{"id": 7, "x": 0, "y": 0, "z": 0, "weaponId": "acorn-mortar"}]})
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
