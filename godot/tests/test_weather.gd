extends TestCase
## Weather and time of day: MapLook.with_sky, the environment it builds, and the Weather node.


func test_sky_of_reads_the_match_config_and_defaults_to_clear_day() -> void:
	check_eq(MapLook.sky_of({}), {"weather": "clear", "time": "day"}, "no sky: clear day")
	var msg := {"config": {"sky": {"weather": "storm", "time": "night"}}}
	check_eq(MapLook.sky_of(msg), {"weather": "storm", "time": "night"}, "reads config.sky")
	var odd := {"config": {"sky": {"weather": "snow", "time": "noon"}}}
	check_eq(MapLook.sky_of(odd), {"weather": "clear", "time": "day"}, "unknown values fall back")


func test_every_combination_makes_a_complete_look() -> void:
	var base := MapLook.for_theme("garden-patch")
	for w in MapLook.WEATHERS:
		for t in MapLook.TIMES:
			var look := MapLook.with_sky(base, w, t)
			for key in ["sky_top", "sky_horizon", "sun", "fog", "cloud"]:
				check(Color.html_is_valid(str(look[key])), "%s/%s: %s is a colour" % [w, t, key])
			check(float(look["sun_energy"]) > 0.0, "%s/%s: some light" % [w, t])
	check_eq(MapLook.with_sky(base, "clear", "day")["sky_top"], base["sky_top"], "clear day is the theme's own look")


func test_night_is_darker_and_lights_windows_and_the_beam() -> void:
	var base := MapLook.for_theme("lighthouse-village")
	var day := MapLook.with_sky(base, "clear", "day")
	var night := MapLook.with_sky(base, "clear", "night")
	check(float(night["sun_energy"]) < float(day["sun_energy"]) * 0.6, "moonlight is dim")
	check(MapLook.color(night, "sky_top").get_luminance() < 0.15, "a dark sky")
	check(bool(night["night"]) and float(night["window_glow"]) == 1.0, "windows lit at night")
	check(float(night["beam"]) > 2.0 and float(day["beam"]) == 1.0, "the beam is brighter at night")


func test_weather_sets_rain_wetness_fog_and_lightning() -> void:
	var base := MapLook.for_theme("garden-patch")
	var rain := MapLook.with_sky(base, "rain", "day")
	var storm := MapLook.with_sky(base, "storm", "day")
	var fog := MapLook.with_sky(base, "fog", "day")
	check(float(rain["rain"]) > 0.0 and float(rain["wetness"]) > 0.0 and not bool(rain["lightning"]), "rain")
	check(float(storm["rain"]) > float(rain["rain"]) and bool(storm["lightning"]), "a storm rains harder, with lightning")
	check(float(storm["sun_energy"]) < float(rain["sun_energy"]), "a storm is darker than rain")
	check(float(fog["fog_near"]) < 120.0 and float(fog["rain"]) == 0.0, "fog comes in closer, no rain")
	check(float(fog.get("fog_banks", 0.0)) > 0.0 and float(fog["fog_density"]) < 0.6, "fog is light haze plus drifting banks")


func test_environment_builds_moon_and_stars_only_at_night() -> void:
	var root := (Engine.get_main_loop() as SceneTree).root
	for t in ["day", "night"]:
		var env := MatchEnvironment.new()
		root.add_child(env)
		var look := MapLook.with_sky(MapLook.for_theme("garden-patch"), "clear", t)
		env.setup(128.0, 128.0, 20.0, func(_x: float, _z: float) -> float: return 30.0, look)
		check_eq(env.moon != null, t == "night", "%s: moon" % t)
		check_eq(env.get_node_or_null("Stars") != null, t == "night", "%s: stars" % t)
		env.free()


func test_storm_rains_and_strikes_with_a_flash() -> void:
	var root := (Engine.get_main_loop() as SceneTree).root
	var env := MatchEnvironment.new()
	root.add_child(env)
	var look := MapLook.with_sky(MapLook.for_theme("garden-patch"), "storm", "dusk")
	env.setup(128.0, 128.0, 20.0, func(_x: float, _z: float) -> float: return 30.0, look)
	var w := Weather.new()
	root.add_child(w)
	w.setup(look, env, 128.0, 128.0, 20.0, 1.0)
	check(w.get_node_or_null("Rain") != null, "rain particles")
	check(w.lightning, "lightning on")
	var before := float(env.get("_world_env").environment.ambient_light_energy)
	w.strike()
	env.update(0.016, Vector2(40, 0))
	check(float(env.get("_world_env").environment.ambient_light_energy) > before + 0.5, "the flash lights the scene")
	check_eq(w.strikes, 1, "one strike")
	var clear := Weather.new()
	root.add_child(clear)
	clear.setup(MapLook.with_sky(MapLook.for_theme("garden-patch"), "clear", "day"), env, 128.0, 128.0, 20.0)
	check(clear.get_node_or_null("Rain") == null and not clear.lightning, "clear weather: nothing")
	check(clear.get_node_or_null("FogBanks") == null, "clear weather: no fog banks")
	var foggy := Weather.new()
	root.add_child(foggy)
	foggy.setup(MapLook.with_sky(MapLook.for_theme("garden-patch"), "fog", "day"), env, 128.0, 128.0, 20.0, 1.0, func(_x: float, _z: float) -> float: return 30.0)
	var bank := foggy.get_node_or_null("FogBanks") as MultiMeshInstance3D
	check(bank != null and foggy.fog_bank_count() >= 5, "fog: drifting banks")
	var t0 := foggy.fog_puffs[0]
	check(t0.y > 30.0 and t0.y < 45.0, "fog hugs the ground")
	foggy.update(1.0, Vector3(64, 40, 64), Vector2(50, 0))
	check(foggy.fog_puffs[0].distance_to(t0) > 1.0, "fog drifts")
	foggy.free()
	w.free()
	clear.free()
	env.free()


func test_thunder_is_a_long_rumble() -> void:
	var near := SfxRecipes.make("thunder", "near")
	var far := SfxRecipes.make("thunder", "far")
	check(near.size() > AudioSynth.SAMPLE_RATE * 2, "over two seconds")
	check(far.size() > 0, "a far rumble too")
