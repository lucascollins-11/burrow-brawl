extends TestCase


func _meshes(node: Node) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	for c in node.find_children("*", "MeshInstance3D", true, false):
		out.append(c)
	return out


func test_there_are_eight_distinct_hats() -> void:
	check_eq(Hats.IDS.size(), 8, "eight hats")
	var seen := {}
	for id in Hats.IDS:
		seen[id] = true
	check_eq(seen.size(), 8, "ids are unique")
	for expected in ["miner", "chef", "cone", "propeller", "crown", "pirate", "flowerpot", "bucket"]:
		check(Hats.IDS.has(expected), "has %s" % expected)


func test_every_hat_builds_a_small_mesh_tree_above_the_origin() -> void:
	for id in Hats.IDS:
		var hat := Hats.make(id, Color("4aa3df"))
		check_eq(hat.name, "Hat", "%s node name" % id)
		check_eq(hat.get_meta("hat_id"), id, "%s remembers its id" % id)
		var meshes := _meshes(hat)
		check(meshes.size() >= 2, "%s has several parts" % id)
		var top := -INF
		for m in meshes:
			var box := m.mesh.get_aabb()
			top = maxf(top, m.position.y + box.end.y * m.scale.y)
		check(top > 0.3 and top < 1.6, "%s stands between 0.3 and 1.6 units tall (got %s)" % [id, top])
		hat.free()


func test_old_names_map_to_the_new_ids_and_unknowns_fall_back() -> void:
	check_eq(Hats.canonical("pot"), "flowerpot", "pot")
	check_eq(Hats.canonical("party"), "bucket", "party")
	check_eq(Hats.canonical("MINER"), "miner", "case is ignored")
	check_eq(Hats.canonical("tophat"), "bucket", "unknown falls back")


func test_default_hat_per_team_slot_cycles_through_all_eight() -> void:
	var seen := {}
	for t in range(8):
		seen[Hats.default_for_team(t)] = true
	check_eq(seen.size(), 8, "eight teams, eight different hats")
	check_eq(Hats.default_for_team(8), Hats.default_for_team(0), "wraps around")
	check_eq(TeamStyle.hat_of(0), "miner", "team style agrees")


func test_propeller_and_lamp_nodes_exist_for_animation() -> void:
	var p := Hats.make("propeller")
	check(p.find_child("Propeller", true, false) != null, "propeller spins")
	p.free()
	var m := Hats.make("miner")
	check(m.find_child("Lamp", true, false) != null, "miner lamp")
	m.free()
