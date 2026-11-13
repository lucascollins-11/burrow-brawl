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
