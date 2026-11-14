extends TestCase
## Head-turn maths for the look-at.


func test_straight_ahead_is_zero() -> void:
	var a := SquirmlingRig.look_angles(Vector3(0, 0, 10))
	check(a.length() < 0.001, "no turn when the target is dead ahead")


func test_turns_towards_the_side() -> void:
	var a := SquirmlingRig.look_angles(Vector3(10, 0, 10))
	check(absf(a.x - PI / 4.0) < 0.01, "45 degrees right, got %f" % a.x)


func test_turn_is_clamped() -> void:
	var a := SquirmlingRig.look_angles(Vector3(0, 0, -10))
	check(absf(a.x) <= 1.0001, "a target behind clamps the turn, got %f" % a.x)
	var up := SquirmlingRig.look_angles(Vector3(0, 100, 1))
	check(up.y <= 0.6001, "pitch is clamped, got %f" % up.y)


func test_looking_up_is_positive_pitch() -> void:
	check(SquirmlingRig.look_angles(Vector3(0, 5, 10)).y > 0.0, "target above gives positive pitch")
