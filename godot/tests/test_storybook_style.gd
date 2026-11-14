extends TestCase

const Style := preload("res://assets/storybook_style.gd")
const LANTERN := "res://assets/thirdparty/polyhaven/Lantern_01/Lantern_01.gltf"


func test_restyle_drops_photo_maps_and_bands_the_light() -> void:
	var src := StandardMaterial3D.new()
	src.albedo_color = Color(0.2, 0.4, 0.8)
	src.normal_enabled = true
	src.metallic = 1.0
	var mi := MeshInstance3D.new()
	mi.mesh = BoxMesh.new()
	mi.mesh.surface_set_material(0, src)
	check_eq(Style.restyle(mi), 1, "one surface restyled")
	var m := mi.get_surface_override_material(0) as StandardMaterial3D
	check(m != null, "a Storybook material replaces the original")
	check_eq(m.diffuse_mode, BaseMaterial3D.DIFFUSE_TOON, "toon-banded light")
	check(not m.normal_enabled, "no normal map")
	check_eq(m.metallic, 0.0, "no metal")
	check(m.albedo_color.s > src.albedo_color.s, "colour pushed toward the painted palette")
	mi.free()


func test_same_source_shares_one_material() -> void:
	var src := StandardMaterial3D.new()
	check(Style.material_for(src) == Style.material_for(src), "cached per source and options")
	check(Style.material_for(src) != Style.material_for(src, {"flat": false}), "options change it")


func test_a_library_model_loads_restyled_at_squirmling_scale() -> void:
	var lamp := Style.instance(LANTERN, {"height": 6.0})
	check(lamp != null, "the Poly Haven lantern loads")
	if lamp == null:
		return
	var box := Style.bounds(lamp)
	check(absf(box.size.y * lamp.scale.y - 6.0) < 0.01, "scaled to 6 units, a Squirmling's height")
	var meshes := lamp.find_children("*", "MeshInstance3D", true, false)
	check(not meshes.is_empty(), "it has meshes")
	for n in meshes:
		var mi := n as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(i) as StandardMaterial3D
			check(m != null and m.diffuse_mode == BaseMaterial3D.DIFFUSE_TOON, "every surface is Storybook")
	lamp.free()
