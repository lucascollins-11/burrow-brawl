extends TestCase


func test_catalog_has_forty_unique_items_in_known_categories() -> void:
	check_eq(WeaponCatalog.ITEMS.size(), 40, "forty items")
	var seen := {}
	for it in WeaponCatalog.ITEMS:
		check(not seen.has(it["id"]), "%s is unique" % it["id"])
		seen[it["id"]] = true
		check(WeaponCatalog.category_name(it["cat"]) != it["cat"], "%s has a known category" % it["id"])
		check(str(it["desc"]) != "", "%s has a description" % it["id"])
	check_eq(WeaponCatalog.ordered().size(), 40, "menu order keeps every item")


func test_the_shipping_weapons_are_in_the_catalog() -> void:
	for w in Controls.WEAPONS:
		check(not WeaponCatalog.find(w["id"]).is_empty(), "%s is in the catalog" % w["id"])


func test_ammo_labels_and_initials() -> void:
	check_eq(WeaponCatalog.ammo_label(-1), "inf", "unlimited")
	check_eq(WeaponCatalog.ammo_label(3), "x3", "count")
	check_eq(WeaponCatalog.ammo_label(0), "out", "none")
	check_eq(WeaponGrid.initials_of("Acorn Mortar"), "AM", "two words")
	check_eq(WeaponGrid.initials_of("Slingshot"), "S", "one word")
	check_eq(WeaponGrid.initials_of("Wind-up Robot"), "WR", "hyphen stays in the word")


func test_grid_has_a_tile_per_item_and_picks_only_available_ones() -> void:
	var grid := WeaponGrid.new()
	grid._ready()
	check_eq(grid._tiles.size(), 40, "a tile for each item")
	grid.set_ammo({"acorn-mortar": -1, "jelly-mine": 2})
	check(grid.is_available("jelly-mine"), "mine has ammo")
	check(not grid.is_available("slingshot"), "slingshot is not in the table")
	var picks: Array = []
	grid.picked.connect(func(id: String) -> void: picks.append(id))
	grid.visible = true
	grid._on_tile("slingshot")
	check_eq(picks.size(), 0, "unavailable tiles do nothing")
	check(grid.visible, "grid stays open after a dead click")
	grid._on_tile("jelly-mine")
	check_eq(picks, ["jelly-mine"], "available tile is picked")
	check(not grid.visible, "grid closes after a pick")
	grid.free()


func test_hud_grid_pick_maps_to_a_weapon_index() -> void:
	var hud := Hud.new()
	var got: Array = []
	hud.weapon_picked.connect(func(i: int) -> void: got.append(i))
	hud._on_weapon_id_picked("fizz-grenade")
	hud._on_weapon_id_picked("slingshot")
	check_eq(got, [1], "only weapons Controls knows are forwarded")
	hud.free()


func test_grid_width_follows_the_number_of_weapons() -> void:
	check_eq(WeaponGrid.columns_for(0), 3, "an empty table still has a shape")
	check_eq(WeaponGrid.columns_for(6), 4, "six weapons: 4 columns")
	check_eq(WeaponGrid.columns_for(12), 5, "twelve weapons: 5 columns")
	check_eq(WeaponGrid.columns_for(40), 8, "the whole arsenal: 8 columns")
