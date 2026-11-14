extends TestCase


func _crit(id: int, extra := {}) -> Dictionary:
	var c := {
		"id": id, "pos": Vector3(10, 5, 10), "heading_deg": 90.0, "alive": true, "grounded": false
	}
	c.merge(extra, true)
	return c


func test_each_act_gets_its_own_gear_and_clears_when_it_ends() -> void:
	var gear := GearFx.new()
	for act in ["jetpack", "umbrella", "boots", "drill"]:
		gear.sync([_crit(1, {"act": act})], 0.016)
		check_eq(gear.state_of(1).get("act", ""), act, "%s is drawn" % act)
		var root := gear.get_node("Gear1") as Node3D
		check(root.get_node_or_null("Act") != null, "%s has parts" % act)
		check_eq(root.position, Vector3(10, 5, 10), "gear follows the critter")
	gear.sync([_crit(1)], 0.016)
	check(gear.state_of(1).is_empty(), "nothing is kept once the act ends")
	gear.free()


func test_jetpack_plume_only_while_in_the_air() -> void:
	var gear := GearFx.new()
	gear.sync([_crit(1, {"act": "jetpack", "grounded": false})], 0.016)
	var plume := gear.get_node("Gear1/Act/Plume1") as CPUParticles3D
	check(plume.emitting, "fizz while flying")
	gear.sync([_crit(1, {"act": "jetpack", "grounded": true})], 0.016)
	check(not plume.emitting, "no fizz on the ground")
	gear.free()


func test_rope_runs_from_the_critter_to_the_anchor() -> void:
	var gear := GearFx.new()
	var anchor := Vector3(10, 45, 10)
	gear.sync([_crit(1, {"act": "rope", "anchor": anchor})], 0.016)
	check(gear.state_of(1)["rope"], "a rope is drawn")
	var rope := gear.get_node("Rope") as MeshInstance3D
	var from := Vector3(10, 5 + Squirmling.HEIGHT * 0.6, 10)
	check(rope.position.distance_to(from.lerp(anchor, 0.5)) < 0.01, "centred between the ends")
	var top := rope.transform * Vector3(0, 0.5, 0)
	var bottom := rope.transform * Vector3(0, -0.5, 0)
	check(
		minf(top.distance_to(anchor), bottom.distance_to(anchor)) < 0.01, "one end is on the anchor"
	)
	check(
		minf(top.distance_to(from), bottom.distance_to(from)) < 0.01,
		"the other end is on the critter"
	)
	gear.sync([_crit(1)], 0.016)
	check(
		gear.get_node_or_null("Rope") == null or gear.get_node("Rope").is_queued_for_deletion(),
		"rope goes away"
	)
	gear.free()


func test_shield_bubble_comes_and_goes_and_dead_critters_wear_nothing() -> void:
	var gear := GearFx.new()
	gear.sync([_crit(1, {"shield": true})], 0.016)
	check(gear.state_of(1)["shield"], "bubble up")
	gear.sync([_crit(1)], 0.016)
	check(gear.state_of(1).is_empty(), "bubble gone")
	gear.sync([_crit(2, {"act": "umbrella", "alive": false})], 0.016)
	check(gear.state_of(2).is_empty(), "a knocked-out critter wears nothing")
	gear.free()


func test_mines_blink_by_state() -> void:
	check_eq(ShotModels.mine_glow(0.1, false, false), 0.0, "dark while arming")
	check_eq(ShotModels.mine_glow(0.1, true, false), 1.0, "lit at the start of an armed blink")
	check_eq(ShotModels.mine_glow(0.6, true, false), 0.0, "dark between armed blinks")
	check_eq(ShotModels.mine_glow(0.02, true, true), 1.0, "triggered flashes")
	check_eq(ShotModels.mine_glow(0.1, true, true), 0.0, "triggered flashes off again")
	var m := ShotModels.make("jelly-mine")
	ShotModels.blink_mine(m, 0.1, true, false)
	var bulb := m.find_child("Bulb", true, false) as MeshInstance3D
	check(
		(bulb.material_override as StandardMaterial3D).emission_energy_multiplier > 3.0,
		"bulb is bright"
	)
	ShotModels.blink_mine(m, 0.6, true, false)
	check(
		(bulb.material_override as StandardMaterial3D).emission_energy_multiplier < 1.0,
		"bulb is dim"
	)
	m.free()


func test_placed_mines_are_drawn_apart_from_shots() -> void:
	var views := ShotViews.new()
	var mine := {
		"id": 1, "weapon": "jelly-mine", "pos": Vector3(4, 4, 4), "armed": true, "triggered": false
	}
	views.sync([{"id": 1, "weapon": "acorn-mortar", "pos": Vector3(1, 2, 3)}], [mine])
	check_eq(views.get_child_count(), 2, "a shot and a mine with the same id both show")
	views.free()


func test_view_model_keeps_acts_shields_and_mines() -> void:
	var vm := ViewModel.new()
	var fixed := float(ViewModel.FIXED_ONE)
	(
		vm
		. apply_state(
			{
				"tick": 3,
				"critters":
				[
					{
						"id": 1,
						"team": 0,
						"x": 0,
						"y": 0,
						"z": 0,
						"yaw": 0,
						"hp": 100,
						"status": "alive",
						"grounded": false,
						"act": "rope",
						"anchor": {"x": 5.0 * fixed, "y": 9.0 * fixed, "z": 0},
						"shield": true
					}
				],
				"projectiles": [],
				"mines":
				[
					{
						"id": 7,
						"ownerId": 1,
						"weaponId": "jelly-mine",
						"x": fixed,
						"y": 0,
						"z": 0,
						"armed": true,
						"triggered": false,
						"fuseTicks": -1
					}
				],
			},
			true
		)
	)
	var s := vm.snapshot()
	var c: Dictionary = s["critters"][0]
	check_eq(c["act"], "rope", "act")
	check_eq(c["anchor"], Vector3(5, 9, 0), "anchor")
	check(c["shield"], "shield")
	check_eq((s["mines"] as Array).size(), 1, "one mine")
	check((s["mines"][0] as Dictionary)["armed"], "armed")
	vm.apply_state(
		{
			"tick": 6,
			"critters":
			[
				{
					"id": 1,
					"team": 0,
					"x": 0,
					"y": 0,
					"z": 0,
					"yaw": 0,
					"hp": 100,
					"status": "alive",
					"grounded": true
				}
			],
			"projectiles": []
		}
	)
	s = vm.snapshot()
	check_eq(s["critters"][0]["act"], "", "act cleared")
	check(not s["critters"][0]["shield"], "shield cleared")
	check_eq((s["mines"] as Array).size(), 0, "mine gone")


func test_frozen_gets_an_ice_shell_and_feather_a_glow() -> void:
	var gear := GearFx.new()
	gear.sync([_crit(1, {"frozen": true, "grounded": true}), _crit(2, {"feather": true, "grounded": true})], 0.016)
	check(gear.state_of(1)["frozen"], "ice shell")
	check(not gear.state_of(1)["feather"], "no glow on the frozen one")
	check(gear.state_of(2)["feather"], "feather glow")
	check(gear.get_node("Gear1/Ice") != null, "shell node")
	check(gear.get_node("Gear2/Glow/Sparkles") != null, "sparkles")
	gear.sync([_crit(1), _crit(2)], 0.016)
	check(gear.state_of(1).is_empty() and gear.state_of(2).is_empty(), "both gone when thawed")
	gear.free()


func test_zones_come_and_dry_up() -> void:
	var views := ZoneViews.new()
	var fire := {"id": 1, "kind": "fire", "pos": Vector3(5, 3, 5), "r": 4.0, "turns": 2}
	var glue := {"id": 2, "kind": "glue", "pos": Vector3(20, 3, 5), "r": 3.0, "turns": 3}
	views.sync([fire, glue], 0.05)
	check_eq(views.kinds(), {1: "fire", 2: "glue"}, "both puddles")
	check(views.get_node("Zone1/Flames") != null, "fire has flames")
	check(views.get_node("Zone2/Bubbles") != null, "glue bubbles")
	views.sync([glue], 0.05)
	check_eq(views.kinds(), {2: "glue"}, "the fire dried up")
	views.free()


func test_view_model_keeps_zones_frozen_and_feather() -> void:
	var vm := ViewModel.new()
	vm.apply_state(
		{
			"tick": 3,
			"critters": [{"id": 1, "team": 0, "x": 0, "y": 0, "z": 0, "yaw": 0, "hp": 100, "status": "alive", "grounded": true, "frozen": true}],
			"projectiles": [],
			"zones": [{"id": 4, "kind": "glue", "x": 10, "y": 2, "z": 12, "r": 5, "turns": 3}],
		},
		true
	)
	var s := vm.snapshot()
	check(s["critters"][0]["frozen"], "frozen")
	check(not s["critters"][0]["feather"], "no feather")
	check_eq((s["zones"] as Array).size(), 1, "one puddle")
	check_eq(s["zones"][0]["pos"], Vector3(10.5, 2, 12.5), "centred on its voxel")


func test_view_model_keeps_a_steered_shot_heading() -> void:
	var vm := ViewModel.new()
	vm.apply_state(
		{
			"tick": 3,
			"critters": [],
			"projectiles":
			[
				{"id": 1, "ownerId": 1, "weaponId": "rc-racer", "x": 0, "y": 0, "z": 0, "fuseTicks": -1, "heading": 256},
				{"id": 2, "ownerId": 1, "weaponId": "acorn-mortar", "x": 0, "y": 0, "z": 0, "fuseTicks": 30},
			],
		},
		true
	)
	var shots: Array = vm.snapshot()["projectiles"]
	check_eq(shots[0]["heading_deg"], 90.0, "256 steps is a quarter turn")
	check_eq(shots[1]["heading_deg"], INF, "a plain shot has no heading")


func test_trigger_is_a_bindable_action_and_pops_a_shot_in_flight() -> void:
	check(not GameSettings.action_def("trigger").is_empty(), "trigger is rebindable")
	var seen := {}
	for a in GameSettings.ACTIONS:
		var k := int(a["key"])
		if a["id"] != "pause" and a["id"] != "cancel_aim":
			check(not seen.has(k), "%s has its own default key" % a["id"])
		seen[k] = true


func test_gatling_act_holds_a_spinning_gun() -> void:
	var gear := GearFx.new()
	gear.sync([_crit(1, {"act": "gatling", "grounded": true})], 0.05)
	check_eq(gear.state_of(1).get("act", ""), "gatling", "gatling is drawn")
	var barrels := gear.get_node("Gear1/Act/Gun/Barrels") as Node3D
	var before := barrels.rotation.z
	gear.sync([_crit(1, {"act": "gatling", "grounded": true})], 0.05)
	check(barrels.rotation.z != before, "the barrels turn")
	gear.free()
