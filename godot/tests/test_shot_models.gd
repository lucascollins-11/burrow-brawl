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


func test_steered_shots_face_their_heading_and_move_their_parts() -> void:
	var views := ShotViews.new()
	for w in ShotModels.STEERED:
		check(ShotModels.KNOWN.has(w), "%s has its own model" % w)
	views.sync([{"id": 1, "weapon": "rc-racer", "pos": Vector3(0, 0, 0), "heading_deg": 90.0}])
	var racer := views.get_child(0) as Node3D
	check(absf(racer.rotation.y - deg_to_rad(90.0)) < 0.001, "racer faces its heading")
	var body := racer.get_node("Body") as Node3D
	check_eq(body.rotation, Vector3.ZERO, "a steered shot does not tumble")
	var robot := ShotModels.make("wind-up-robot")
	ShotModels.animate(robot, "wind-up-robot", 0.1, 5.0)
	var left := robot.get_node("Body/Leg-1") as Node3D
	var right := robot.get_node("Body/Leg1") as Node3D
	check(absf(left.rotation.x - right.rotation.x) > 0.1, "the legs swing out of step")
	robot.free()
	views.free()


func test_mousetrap_is_a_mine_model_and_does_not_tumble() -> void:
	check(ShotModels.KNOWN.has("mousetrap-snapper"), "has a model")
	var views := ShotViews.new()
	views.sync([], [{"id": 3, "weapon": "mousetrap-snapper", "pos": Vector3(1, 1, 1), "armed": true, "triggered": false}])
	var body := views.get_child(0).get_node("Body") as Node3D
	check_eq(body.rotation, Vector3.ZERO, "a mine lies still")
	check(body.get_child_count() > 3, "board, bar and cheese")
	views.free()


func test_air_strike_and_super_projectiles_have_their_own_models() -> void:
	for w in ["paper-lantern", "giant-block", "meteor-marble", "pinata", "candy-bomb", "boulder-of-doom"]:
		check(ShotModels.KNOWN.has(w), "%s has its own model" % w)
		var m := ShotModels.make(w)
		check(m.get_node("Body").get_child_count() > 1, "%s is more than a ball" % w)
		m.free()
