extends TestCase


func test_every_known_weapon_has_a_spinning_body_and_a_trail() -> void:
	for w in ShotModels.KNOWN:
		var m := ShotModels.make(w)
		check(m.get_node_or_null("Body") != null, "%s has a body" % w)
		check(m.get_node("Body").get_child_count() > 0, "%s body has parts" % w)
		check(m.get_node_or_null("Trail") != null, "%s leaves a trail" % w)
		check_eq(m.get_meta("weapon"), w, "%s remembers its weapon" % w)
		m.free()


func test_unknown_weapons_get_a_plain_ball() -> void:
	var m := ShotModels.make("mystery-thing")
	check(m.get_node_or_null("Body") != null, "still a body")
	check_eq(m.get_node("Body").get_child_count(), 1, "just a ball")
	m.free()


func test_every_projectile_weapon_in_shared_has_a_model() -> void:
	# The ids the server can launch as projectiles today.
	for w in ["acorn-mortar", "fizz-grenade", "pinecone-popper", "pinecone-seed", "beehive-bomb", "hopper-ball", "firecracker-bundle"]:
		check(ShotModels.KNOWN.has(w), "%s has its own model" % w)


func test_shots_sync_creates_removes_and_reports_lost_ones() -> void:
	var views := ShotViews.new()
	var lost: Array = []
	views.lost.connect(func(at: Vector3, weapon: String) -> void: lost.append([at, weapon]))
	views.sync([{"id": 1, "weapon": "acorn-mortar", "pos": Vector3(1, 2, 3)}])
	check_eq(views.get_child_count(), 1, "one shot node")
	views.sync([])
	check_eq(lost.size(), 1, "loss reported")
	check_eq(lost[0][0], Vector3(1, 2, 3), "at its last position")
	check_eq(lost[0][1], "acorn-mortar", "with its weapon")
	views.free()
