extends TestCase


func test_every_critter_in_a_full_match_has_its_own_name() -> void:
	var seen := {}
	for id in range(0, 40):
		var n := CritterNames.name_of(id)
		check(n != "", "critter %d has a name" % id)
		check(not seen.has(n), "%s is used once" % n)
		seen[n] = true


func test_names_are_stable_and_wrap_for_odd_ids() -> void:
	check_eq(CritterNames.name_of(3), CritterNames.name_of(3), "same id, same name")
	check_eq(CritterNames.name_of(-1), CritterNames.NAMES[CritterNames.NAMES.size() - 1], "negative ids wrap")
	check(not CritterNames.name_of(7).begins_with("Squirmling"), "no more Squirmling N")


func test_tag_shows_name_health_and_hides_far_away_or_behind_terrain() -> void:
	var rig := Squirmling.create(0, "miner", Color("e85d4a"))
	(Engine.get_main_loop() as SceneTree).root.add_child(rig)
	Squirmling.set_tag(rig, "Pip", Color("ff8070"), 0.5)
	var label := rig.get_node("Tag/Name") as Label3D
	check_eq(label.text, "Pip", "the name is on the tag")
	var mat := (rig.get_node("Tag/Bar") as MeshInstance3D).material_override as ShaderMaterial
	check_eq(float(mat.get_shader_parameter("frac")), 0.5, "the bar shows half health")
	rig.update_tag(rig.global_position + Vector3(0, 0, 50), false)
	check(rig.get_node("Tag").visible, "visible at 50 voxels")
	var near_scale: float = (rig.get_node("Tag") as Node3D).scale.x
	rig.update_tag(rig.global_position + Vector3(0, 0, 200), false)
	check((rig.get_node("Tag") as Node3D).scale.x > near_scale, "bigger in the world when far, so it stays readable")
	check(rig.get_node("Tag/Name").modulate.a < 1.0, "fading when far")
	rig.update_tag(rig.global_position + Vector3(0, 0, 300), false)
	check(not rig.get_node("Tag").visible, "gone beyond 260 voxels")
	rig.update_tag(rig.global_position + Vector3(0, 0, 40), true)
	check(not rig.get_node("Tag").visible, "hidden behind terrain")
	rig.set_first_person(true)
	rig.update_tag(rig.global_position + Vector3(0, 0, 40), false)
	check(not rig.get_node("Tag").visible and not rig.get_node("Model").visible, "first person hides body and tag")
	rig.set_first_person(false)
	check(rig.get_node("Model").visible, "and brings them back")
	rig.free()


func test_tag_text_never_gets_smaller_than_the_floor_and_scales_with_the_screen() -> void:
	check(SquirmlingRig.tag_pixels(500.0, 720.0) >= 14.0, "readable even far away")
	check(SquirmlingRig.tag_pixels(10.0, 720.0) <= 23.0, "capped when close")
	check(SquirmlingRig.tag_pixels(100.0, 1440.0) > SquirmlingRig.tag_pixels(100.0, 720.0), "bigger on a taller screen")
	var rig := Squirmling.create(0, "miner", Color("e85d4a"))
	(Engine.get_main_loop() as SceneTree).root.add_child(rig)
	var label := rig.get_node("Tag/Name") as Label3D
	for d in [30.0, 80.0, 150.0]:
		rig.update_tag(rig.get_node("Tag").global_position + Vector3(0, 0, d), false)
		var px: float = float(label.font_size) * label.pixel_size * (rig.get_node("Tag") as Node3D).scale.x * 360.0 / (d * tan(deg_to_rad(30.0)))
		check(absf(px - SquirmlingRig.tag_pixels(d, 720.0)) < 0.5, "text is %d px at %d voxels" % [int(px), int(d)])
	rig.free()
