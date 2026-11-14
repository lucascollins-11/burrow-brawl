extends TestCase

## Flat ground at y 40 with a pit (y 20) where x < 40, standing in for the terrain.
var pit_open := false


func _ground(x: float, _z: float) -> float:
	return 20.0 if pit_open and x < 40.0 else 40.0


func _make(theme := "garden-patch", seed_value := 5) -> Scenery:
	var s := Scenery.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(s)
	s.setup(theme, 128.0, 128.0, 26.0, Callable(self, "_ground"), seed_value, 1.0)
	return s


func test_scatters_light_props_and_life_for_every_theme() -> void:
	for theme in Scenery.THEME_SET:
		var s := _make(theme)
		check(s.prop_count > 8 and s.prop_count < 200, "%s: a light scatter (%d props on 128 x 128)" % [theme, s.prop_count])
		check(not s.find_children("*", "MultiMeshInstance3D", true, false).is_empty(), "%s: drawn with MultiMeshes" % theme)
		s.free()


func test_same_seed_same_layout() -> void:
	var a := _make("garden-patch", 9)
	var b := _make("garden-patch", 9)
	check_eq(a.prop_count, b.prop_count, "same count for the same seed")
	a.free()
	b.free()


func test_props_fall_away_with_blasted_ground() -> void:
	pit_open = false
	var s := _make()
	var before := s.prop_count
	pit_open = true
	var gone := s.on_patch({"x0": 0, "y0": 0, "z0": 0, "sx": 40, "sy": 64, "sz": 128})
	check(gone > 0, "props over the blasted area are removed (%d)" % gone)
	check_eq(s.prop_count, before - gone, "the count follows")
	check_eq(s.on_patch({"x0": 60, "y0": 0, "z0": 0, "sx": 40, "sy": 64, "sz": 128}), 0, "untouched ground keeps its props")
	pit_open = false
	s.free()


func test_fillers_stay_below_a_squirmlings_head() -> void:
	var s := Scenery.new()
	for set_id: String in Scenery.SETS:
		for kind: String in Scenery.SETS[set_id]:
			if kind in ["library", "flag", "pipe"]:
				continue
			var top := 0.0
			for i in 30:
				for part: Array in s._parts(kind):
					var xf: Transform3D = part[1]
					top = maxf(top, xf.origin.y + xf.basis.get_scale().y * 0.5)
			check(top < Scenery.MAX_FILLER_HEIGHT, "%s stays under %.1f (tallest %.1f)" % [kind, Scenery.MAX_FILLER_HEIGHT, top])
	s.free()


func test_start_positions_stay_clear() -> void:
	var s := Scenery.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(s)
	var spot := Vector3(64, 40, 64)
	s.setup("frosted-bakery", 128.0, 128.0, 26.0, Callable(self, "_ground"), 3, 1.0, [spot])
	var near := 0
	for p: Dictionary in s._props:
		if not p.is_empty() and Vector2(p["pos"].x - spot.x, p["pos"].z - spot.z).length() < Scenery.CLEAR_RADIUS:
			near += 1
	check_eq(near, 0, "nothing within %.0f of a Squirmling's start" % Scenery.CLEAR_RADIUS)
	s.free()


func test_landmarks_ring_the_island_with_villages_and_ships() -> void:
	for theme in Scenery.THEME_SET:
		var l := Landmarks.new()
		(Engine.get_main_loop() as SceneTree).root.add_child(l)
		l.setup(theme, 128.0, 128.0, 26.0, 3, 1.0)
		check(l.islets.size() >= 3, "%s: village islets on the horizon (%d)" % [theme, l.islets.size()])
		check(not l.ships.is_empty(), "%s: ships on the sea" % theme)
		var buildings := 0
		for c in l.find_children("*", "MeshInstance3D", true, false):
			if str(c.get_path()).contains("building"):
				buildings += 1
		check(buildings >= l.islets.size() * 3, "%s: library buildings loaded (%d meshes)" % [theme, buildings])
		var centre := Vector2(64, 64)
		for islet: Dictionary in l.islets:
			var p: Vector3 = islet["pos"]
			check(Vector2(p.x, p.z).distance_to(centre) - float(islet["radius"]) > 91.0, "%s: islets stay off the map" % theme)
		for s in l.ships:
			check(absf(s.position.y - 26.0) < 30.0, "%s: ships float at sea level" % theme)
		l.free()
