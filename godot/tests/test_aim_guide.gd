extends TestCase


func _flat_ground(_x: float, _z: float) -> float:
	return 0.0


func test_the_arc_climbs_then_falls_and_scales_with_power() -> void:
	var dir := Vector3(0.0, 0.7071, 0.7071)
	var weak := AimGuide.arc_points(Vector3(0, 10, 0), dir, "acorn-mortar", 25.0, Callable(self, "_flat_ground"))
	var strong := AimGuide.arc_points(Vector3(0, 10, 0), dir, "acorn-mortar", 100.0, Callable(self, "_flat_ground"))
	check(strong.size() >= 8, "a full charge gets a long dotted guide")
	check(strong.back().z > weak.back().z, "more power reaches further")
	check(strong[0].y > 10.0, "it starts by climbing")
	check(strong.back().y < strong[strong.size() / 2].y + 40.0, "and gravity bends it")


func test_the_guide_stops_where_the_ground_is() -> void:
	var wall := func(_x: float, _z: float) -> float: return 1000.0
	check_eq(AimGuide.arc_points(Vector3(0, 10, 0), Vector3.FORWARD, "acorn-mortar", 80.0, wall).size(), 0, "buried at once, nothing drawn")


func test_only_arc_weapons_get_a_guide() -> void:
	check(AimGuide.has_arc("acorn-mortar") and AimGuide.has_arc("slingshot"), "arc weapons")
	check(not AimGuide.has_arc("fizz-rocket") and not AimGuide.has_arc("pepper-shotgun"), "rockets and guns have none")
	check_eq(AimGuide.arc_points(Vector3.ZERO, Vector3.FORWARD, "fizz-rocket", 80.0, Callable()).size(), 0, "no points for a rocket")
	check_eq(AimGuide.arc_points(Vector3.ZERO, Vector3.FORWARD, "acorn-mortar", 0.0, Callable()).size(), 0, "no charge, no guide")
