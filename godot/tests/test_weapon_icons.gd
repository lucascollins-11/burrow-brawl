extends TestCase
## Every weapon has an icon model, and the picker holds a picture slot for each tile.


func test_every_weapon_has_an_icon_model() -> void:
	var count := 0
	for it in WeaponCatalog.ordered():
		var id := str(it["id"])
		count += 1
		var m := WeaponIconModels.make(id)
		check(m != null, "icon model for %s" % id)
		if m != null:
			check(m.find_children("*", "MeshInstance3D", true, false).size() > 0, "%s model has meshes" % id)
			m.free()
	check(count >= 40, "the catalogue lists all weapons")


func test_picker_has_a_picture_slot_per_tile() -> void:
	var grid := WeaponGrid.new()
	grid._ready()
	check_eq(grid._pics.size(), grid._tiles.size(), "a picture slot per tile")
	grid.free()
