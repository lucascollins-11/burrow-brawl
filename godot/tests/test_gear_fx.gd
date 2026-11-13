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
