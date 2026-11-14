extends TestCase
## The visual smoother: continuous speed, no overshoot, snaps on a burrow.


func test_follows_without_overshoot() -> void:
	var s := CritterSmoother.new()
	s.step(Vector3.ZERO, true, 0.016)
	var peak := 0.0
	for i in range(120):
		var p := s.step(Vector3(10, 0, 0), true, 0.016)
		peak = maxf(peak, p.x)
	check(peak <= 10.001, "no overshoot, peak %f" % peak)
	check(absf(s.pos.x - 10.0) < 0.05, "settles on the target, at %f" % s.pos.x)


func test_speed_is_continuous_on_steps() -> void:
	# A target that jumps one voxel every 50 ms (a stepped server position).
	var s := CritterSmoother.new()
	s.step(Vector3.ZERO, true, 0.016)
	var last := 0.0
	var worst := 0.0
	for i in range(100):
		var target := Vector3(float(int(float(i) * 0.016 / 0.05)) * 0.4, 0, 0)
		s.step(target, true, 0.016)
		worst = maxf(worst, absf(s.vel.x - last))
		last = s.vel.x
	check(worst < 4.0, "speed changes by at most 4.0 per frame, got %f" % worst)


func test_snaps_on_teleport() -> void:
	var s := CritterSmoother.new()
	s.step(Vector3.ZERO, true, 0.016)
	var p := s.step(Vector3(40, 3, 40), true, 0.016)
	check(p == Vector3(40, 3, 40), "teleport snaps")
	check(s.vel == Vector3.ZERO, "teleport clears speed")


func test_big_frame_is_stable() -> void:
	var s := CritterSmoother.new()
	s.step(Vector3.ZERO, true, 0.016)
	var p := s.step(Vector3(5, 0, 0), true, 5.0)
	check(p.x >= 0.0 and p.x <= 5.001, "huge dt stays between")
