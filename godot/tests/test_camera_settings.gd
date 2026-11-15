extends TestCase

const TMP := "user://test_camera_settings.cfg"
const WORLD := Vector2(512, 512)


func _reset() -> void:
	GameSettings.cam_orbit_mouse = 0.75
	GameSettings.cam_orbit_stick = 0.75
	GameSettings.cam_distance = 70.0
	GameSettings.cam_fov = 60.0
	GameSettings.cam_smoothing = 0.5
	GameSettings.cam_pull = CameraMath.PULL_REDUCED
	GameSettings.sensitivity = 1.0
	GameSettings.stick_sensitivity = 1.0
	GameSettings.invert_y = false


## Ground height as a function of x, for the probe.
func _ground(f: Callable) -> Callable:
	return func(x: float, _z: float) -> float: return f.call(x)


func test_the_probe_sees_a_clear_line_as_clear() -> void:
	var flat := _ground(func(_x: float) -> float: return 10.0)
	var d := CameraMath.clear_distance(Vector3(100, 20, 100), Vector3(160, 60, 100), flat, WORLD, 7.0)
	check_eq(d, Vector3(100, 20, 100).distance_to(Vector3(160, 60, 100)), "the whole span")


func test_a_wide_hill_blocks_the_camera_and_pulls_it_in() -> void:
	var hill := _ground(func(x: float) -> float: return 60.0 if x > 130.0 and x < 150.0 else 10.0)
	var target := Vector3(100, 20, 100)
	var pos := Vector3(190, 30, 100)
	var d := CameraMath.clear_distance(target, pos, hill, WORLD, 7.0)
	check(d < target.distance_to(pos) - 20.0, "pulled in well before the hill (%f)" % d)
	check(d >= 7.0, "never closer than the minimum")


func test_a_thin_post_or_bump_is_ignored() -> void:
	# One probe sample wide: 40 samples over a 90 voxel line is about 2.3 voxels apart.
	var post := _ground(func(x: float) -> float: return 60.0 if absf(x - 140.0) < 0.6 else 10.0)
	var target := Vector3(100, 20, 100)
	var pos := Vector3(190, 30, 100)
	check_eq(CameraMath.clear_distance(target, pos, post, WORLD, 7.0), target.distance_to(pos), "a post does not count")
	# A low bump the line clears by more than the clearance does not count either.
	var bump := _ground(func(x: float) -> float: return 19.0 if x > 130.0 and x < 150.0 else 10.0)
	var high_target := Vector3(100, 40, 100)
	var high_pos := Vector3(190, 50, 100)
	check_eq(CameraMath.clear_distance(high_target, high_pos, bump, WORLD, 7.0), high_target.distance_to(high_pos), "a low bump")


func test_ground_beside_the_target_is_ignored() -> void:
	var near := _ground(func(x: float) -> float: return 80.0 if absf(x - 100.0) < 4.0 else 10.0)
	var target := Vector3(100, 20, 100)
	var pos := Vector3(190, 30, 100)
	check_eq(CameraMath.clear_distance(target, pos, near, WORLD, 7.0), target.distance_to(pos), "the target's own surroundings")


func test_pull_modes() -> void:
	var dt := 1.0 / 60.0
	# Off never pulls in.
	check(CameraMath.step_pull(30.0, 60.0, 20.0, CameraMath.PULL_OFF, dt) > 1.0e8, "off")
	# Full pulls in at once, and does not ease back out for a small clearing (hysteresis).
	check_eq(CameraMath.step_pull(1.0e9, 60.0, 25.0, CameraMath.PULL_FULL, dt), 25.0, "full pulls in at once")
	check_eq(CameraMath.step_pull(25.0, 60.0, 27.0, CameraMath.PULL_FULL, dt), 25.0, "full holds within the gap")
	check(CameraMath.step_pull(25.0, 60.0, 50.0, CameraMath.PULL_FULL, dt) > 25.0, "full eases out when clear")
	# Reduced never snaps: one frame moves it only part of the way, in or out.
	var in_step := CameraMath.step_pull(60.0, 60.0, 25.0, CameraMath.PULL_REDUCED, dt)
	check(in_step < 60.0 and in_step > 50.0, "reduced pulls in smoothly (%f)" % in_step)
	var out_step := CameraMath.step_pull(25.0, 60.0, 60.0, CameraMath.PULL_REDUCED, dt)
	check(out_step > 25.0 and out_step < 26.0, "reduced eases back slowly (%f)" % out_step)
	check_eq(CameraMath.step_pull(40.0, 60.0, 39.5, CameraMath.PULL_REDUCED, dt), 40.0, "reduced ignores a tiny block")
	check_eq(CameraMath.step_pull(40.0, 60.0, 42.0, CameraMath.PULL_REDUCED, dt), 40.0, "reduced holds within the gap")


func test_reduced_pull_settles_without_pumping_over_a_bumpy_probe() -> void:
	# The probe flickers between 38 and 42 voxels (bumps and props); the camera must stay put.
	var pull := 40.0
	var lo := pull
	var hi := pull
	for i in range(600):
		var allowed := 38.0 if i % 2 == 0 else 42.0
		pull = CameraMath.step_pull(pull, 60.0, allowed, CameraMath.PULL_REDUCED, 1.0 / 60.0)
		lo = minf(lo, pull)
		hi = maxf(hi, pull)
	check(hi - lo < 1.5, "stays within 1.5 voxels (range %f)" % (hi - lo))


func test_the_ground_floor_lift_rises_fast_and_settles_slowly() -> void:
	var dt := 1.0 / 60.0
	var up := CameraMath.step_lift(0.0, 4.0, dt)
	check(up > 0.3, "rises at once (%f)" % up)
	var down := CameraMath.step_lift(4.0, 0.0, dt)
	check(down > 3.5, "settles back slowly (%f)" % down)


func test_smoothing_scales_the_rig_catch_up() -> void:
	var goal := {"mode": "orbit", "target": Vector3(40, 0, 0)}
	var slow := CameraMath.step_rig(CameraMath.RigState.new(), goal, 0.1, 0.25)
	var normal := CameraMath.step_rig(CameraMath.RigState.new(), goal, 0.1, 1.0)
	var snappy := CameraMath.step_rig(CameraMath.RigState.new(), goal, 0.1, 2.0)
	var goal_at: Vector3 = goal["target"]
	check(
		slow.target.distance_to(goal_at) > normal.target.distance_to(goal_at) and normal.target.distance_to(goal_at) > snappy.target.distance_to(goal_at),
		"more scale, closer to the goal after the same time",
	)
	_reset()
	GameSettings.cam_smoothing = 0.5
	check_eq(GameSettings.cam_rate_scale(), 1.0, "the middle is the original feel")
	GameSettings.cam_smoothing = 0.0
	check_eq(GameSettings.cam_rate_scale(), 2.0, "none is twice as snappy")
	GameSettings.cam_smoothing = 1.0
	check_eq(GameSettings.cam_rate_scale(), 0.25, "full is a quarter as quick")
	_reset()


func test_camera_settings_round_trip_and_clamp() -> void:
	_reset()
	GameSettings.cam_orbit_mouse = 1.5
	GameSettings.cam_orbit_stick = 0.5
	GameSettings.cam_distance = 100.0
	GameSettings.cam_fov = 80.0
	GameSettings.cam_smoothing = 0.9
	GameSettings.cam_pull = CameraMath.PULL_OFF
	GameSettings.save_file(TMP)
	_reset()
	GameSettings.load_file(TMP)
	check_eq(GameSettings.cam_orbit_mouse, 1.5, "mouse orbit")
	check_eq(GameSettings.cam_orbit_stick, 0.5, "stick orbit")
	check_eq(GameSettings.cam_distance, 100.0, "distance")
	check_eq(GameSettings.cam_fov, 80.0, "fov")
	check_eq(GameSettings.cam_smoothing, 0.9, "smoothing")
	check_eq(GameSettings.cam_pull, CameraMath.PULL_OFF, "pull-in")
	var cfg := ConfigFile.new()
	cfg.set_value("camera", "distance", 5000.0)
	cfg.set_value("camera", "fov", 5.0)
	cfg.set_value("camera", "pull", 9)
	cfg.set_value("camera", "smoothing", -3.0)
	cfg.save(TMP)
	GameSettings.load_file(TMP)
	check_eq(GameSettings.cam_distance, GameSettings.CAM_DISTANCE_MAX, "distance clamped")
	check_eq(GameSettings.cam_fov, GameSettings.CAM_FOV_MIN, "fov clamped")
	check_eq(GameSettings.cam_pull, CameraMath.PULL_NAMES.size() - 1, "pull clamped")
	check_eq(GameSettings.cam_smoothing, 0.0, "smoothing clamped")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TMP))
	_reset()


func test_setting_a_camera_option_bumps_the_version() -> void:
	_reset()
	var before := GameSettings.cam_version
	GameSettings.cam_fov = 60.0  # plain assignment does not
	check_eq(GameSettings.cam_version, before, "no bump without a setter")
	GameSettings.cam_version += 1
	check(GameSettings.cam_version > before, "version moves")
	_reset()


func test_orbit_uses_its_own_speeds_not_the_aim_sensitivity() -> void:
	_reset()
	GameSettings.sensitivity = 3.0
	GameSettings.cam_orbit_mouse = 0.5
	check_eq(GameSettings.scale_orbit_mouse(10.0, 4.0), Vector2(5.0, 2.0), "mouse orbit ignores aim sensitivity")
	GameSettings.invert_y = true
	check_eq(GameSettings.scale_orbit_mouse(10.0, 4.0), Vector2(5.0, -2.0), "invert applies")
	GameSettings.invert_y = false
	GameSettings.stick_sensitivity = 3.0
	var a := GameSettings.stick_look(Vector2(1, 0), 0.1, 0.5)
	var b := GameSettings.stick_look(Vector2(1, 0), 0.1, 1.0)
	check(absf(a.x * 2.0 - b.x) < 0.001, "stick orbit takes its own speed")
	_reset()


func test_menu_has_a_camera_tab_with_every_option() -> void:
	_reset()
	var menu := SettingsMenu.new()
	menu._ready()
	var page := menu._tabs.get_tab_control(3)
	check_eq(page.name, "Camera", "fourth tab")
	var sliders := 0
	var options := 0
	var stack: Array = [page]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is HSlider:
			sliders += 1
		elif n is OptionButton:
			options += 1
		stack.append_array(n.get_children())
	check_eq(sliders, 5, "orbit mouse, orbit stick, distance, fov, smoothing")
	check_eq(options, 1, "terrain pull-in")
	menu.free()
	_reset()
