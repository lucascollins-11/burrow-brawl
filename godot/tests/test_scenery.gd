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


func test_scatters_dense_props_and_life_for_every_theme() -> void:
	for theme in Scenery.THEME_SET:
		var s := _make(theme)
		check(s.prop_count > 300, "%s: a dense scatter (%d props on 128 x 128)" % [theme, s.prop_count])
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
