extends TestCase


func test_there_are_seven_pages_with_a_title_and_a_short_text() -> void:
	check_eq(HowToPlay.page_count(), 7, "seven pages")
	var titles := {}
	for i in range(HowToPlay.page_count()):
		var p := HowToPlay.page(i)
		check(str(p["title"]).length() > 0, "page %d has a title" % i)
		var text := str(p["text"])
		check(text.length() > 40, "page %d has a real text" % i)
		check(text.length() <= 200, "page %d text is short enough for the card" % i)
		check(not titles.has(p["title"]), "page %d title is unique" % i)
		titles[p["title"]] = true


func test_every_page_names_a_known_drawing() -> void:
	var known := ["goal", "turns", "move", "aim", "wind", "weapons", "water"]
	for i in range(HowToPlay.page_count()):
		check(known.has(str(HowToPlay.page(i)["art"])), "page %d drawing is known" % i)


func test_out_of_range_pages_are_clamped() -> void:
	check_eq(HowToPlay.page(-3)["title"], HowToPlay.page(0)["title"], "below the first page is the first")
	check_eq(
		HowToPlay.page(99)["title"],
		HowToPlay.page(HowToPlay.page_count() - 1)["title"],
		"past the last page is the last"
	)


func test_the_text_uses_the_real_controls() -> void:
	# The tutorial must match the keys in godot/game/controls.gd.
	var all := ""
	for i in range(HowToPlay.page_count()):
		all += str(HowToPlay.page(i)["text"]) + " "
	check(all.contains("Tab"), "aim key is named")
	check(all.contains("Backspace"), "skip key is named")
	check(all.contains("Acorn Mortar") and all.contains("Fizz Grenade"), "both weapons are named")
