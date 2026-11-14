extends TestCase


func _fx() -> MatchEffects:
	var fx := MatchEffects.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(fx)
	return fx


func test_bigger_blasts_throw_more_and_shake_harder() -> void:
	var small := _fx()
	small.explode(Vector3(10, 10, 10), 2.0)
	var small_kids := small.get_child_count()
	var small_shake: float = small._shake
	var big := _fx()
	big.explode(Vector3(10, 10, 10), 12.0)
	check(small_kids >= 8, "a blast is flash, fireball, ring, sparks, chunks, smoke and a light")
	check(big._shake > small_shake, "a big blast kicks the camera harder")
	check(big._shake <= 1.0, "shake is capped")
	small.free()
	big.free()


func test_far_blasts_shake_less() -> void:
	var near := _fx()
	near.listener = Vector3.ZERO
	near.explode(Vector3(5, 0, 0), 6.0)
	var far := _fx()
	far.listener = Vector3.ZERO
	far.explode(Vector3(400, 0, 0), 6.0)
	check(far._shake < near._shake, "distance softens the kick")
	check(far._shake > 0.0, "but never to nothing")
	near.free()
	far.free()


func test_splash_ripples_and_throws_drops() -> void:
	var fx := _fx()
	fx.splash(Vector3(0, 5, 0), 4.0)
	check(fx.get_child_count() >= 4, "two rings, drops and a puff")
	fx.free()


func test_shake_decays_to_zero() -> void:
	var fx := _fx()
	fx.explode(Vector3.ZERO, 6.0)
	for i in range(120):
		fx.update(0.05)
	check_eq(fx._shake, 0.0, "shake dies away")
	fx.free()


func test_a_tracer_that_hits_throws_sparks_a_miss_does_not() -> void:
	var miss := _fx()
	miss.tracer(Vector3.ZERO, Vector3(20, 0, 0), false)
	var hit := _fx()
	hit.tracer(Vector3.ZERO, Vector3(20, 0, 0), true)
	check(hit.get_child_count() > miss.get_child_count(), "a hit adds sparks and a puff")
	miss.free()
	hit.free()


func test_a_punch_that_connects_says_pow() -> void:
	var whiff := _fx()
	whiff.punch(Vector3.ZERO, 0)
	var smack := _fx()
	smack.punch(Vector3.ZERO, 2)
	check(smack.get_child_count() > whiff.get_child_count(), "connecting adds sparks and a word")
	var has_word := false
	for c in smack.get_children():
		if c is Label3D and (c as Label3D).text == "POW!":
			has_word = true
	check(has_word, "the word pops up")
	whiff.free()
	smack.free()


func test_teleport_effects_appear_at_both_ends() -> void:
	var fx := _fx()
	fx.teleport(Vector3(0, 5, 0), Vector3(50, 5, 0))
	var near_from := 0
	var near_to := 0
	for c in fx.get_children():
		if c is Node3D:
			var x := (c as Node3D).position.x
			if x < 25.0:
				near_from += 1
			else:
				near_to += 1
	check(near_from >= 3 and near_to >= 3, "swirl, column and puff at each end")
	fx.free()


func test_burst_and_dust_build() -> void:
	var fx := _fx()
	fx.burst(Vector3(0, 20, 0), Color.BROWN)
	var after_burst := fx.get_child_count()
	check(after_burst >= 3, "puff, ring and seeds")
	fx.dust(Vector3.ZERO, 2.0)
	check(fx.get_child_count() > after_burst, "dust adds a ring and a puff")
	fx.free()


func test_a_dropped_crate_reports_touching_down_once() -> void:
	var crates := CrateViews.new()
	var landings: Array = []
	crates.landed.connect(func(at: Vector3) -> void: landings.append(at))
	var list := [{"id": 1, "kind": "weapon", "weapon": "fizz-grenade", "pos": Vector3(4, 6, 8)}]
	for i in range(40):
		crates.sync(list, 0.05, true)
	check_eq(landings.size(), 1, "one landing")
	check_eq(landings[0], Vector3(4, 6, 8), "where it came to rest")
	crates.free()


func test_crates_that_were_already_there_do_not_thump() -> void:
	var crates := CrateViews.new()
	var landings: Array = []
	crates.landed.connect(func(at: Vector3) -> void: landings.append(at))
	var list := [{"id": 1, "kind": "health", "weapon": "", "pos": Vector3(1, 1, 1)}]
	for i in range(10):
		crates.sync(list, 0.05, false)
	check_eq(landings.size(), 0, "no landing for crates seen at match start")
	crates.free()


func test_melee_and_tracers_differ_by_weapon() -> void:
	var fx := _fx()
	var before := fx.get_child_count()
	fx.melee(Vector3(5, 5, 5), 1, "spatula-swat")
	var spatula := fx.get_child_count() - before
	before = fx.get_child_count()
	fx.melee(Vector3(5, 5, 5), 0, "pillow-bash")
	check(spatula > 2, "a spatula swing draws arcs, sparks and a word")
	check(fx.get_child_count() - before > 2, "a pillow bash draws a feather burst")
	before = fx.get_child_count()
	fx.melee(Vector3(5, 5, 5), 1, "")
	check(fx.get_child_count() > before, "no weapon falls back to the punch")
	before = fx.get_child_count()
	fx.tracer(Vector3.ZERO, Vector3(10, 0, 0), true, "water-pistol")
	fx.tracer(Vector3.ZERO, Vector3(10, 0, 0), true, "pea-gatling")
	check(fx.get_child_count() > before, "water and pea tracers draw")
	fx.free()
