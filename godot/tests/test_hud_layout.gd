extends TestCase


func test_right_and_bottom_panels_grow_towards_the_middle_of_the_screen() -> void:
	var c := Control.new()
	Hud._place(c, Control.PRESET_TOP_RIGHT, 10)
	check_eq(c.grow_horizontal, Control.GROW_DIRECTION_BEGIN, "right panel grows left")
	check_eq(c.grow_vertical, Control.GROW_DIRECTION_END, "top panel grows down")
	check_eq(c.offset_right, -float(Hud.EDGE), "kept off the right edge")
	check_eq(c.offset_top, float(Hud.EDGE), "kept off the top edge")
	Hud._place(c, Control.PRESET_BOTTOM_LEFT, 10)
	check_eq(c.grow_horizontal, Control.GROW_DIRECTION_END, "left panel grows right")
	check_eq(c.grow_vertical, Control.GROW_DIRECTION_BEGIN, "bottom panel grows up")
	check_eq(c.offset_bottom, -float(Hud.EDGE), "kept off the bottom edge")
	c.free()


func test_centred_panels_grow_both_ways_and_use_their_own_margin() -> void:
	var c := Control.new()
	Hud._place(c, Control.PRESET_CENTER_BOTTOM, 60)
	check_eq(c.grow_horizontal, Control.GROW_DIRECTION_BOTH, "centred horizontally")
	check_eq(c.grow_vertical, Control.GROW_DIRECTION_BEGIN, "grows up from the bottom")
	check_eq(c.offset_bottom, -60.0, "own bottom margin")
	check_eq(c.offset_left, 0.0, "no sideways offset")
	c.free()


func test_sample_results_make_a_finished_match_with_a_winner_on_top() -> void:
	var v := Hud.sample_results(2, 8)
	check_eq(v["phase"], "over", "the match is over")
	check_eq(v["teams"].size(), 8, "eight teams")
	var rows := HudModel.standings(v)
	check_eq(rows[0]["index"], 2, "the winner is first")
	check(rows[0]["alive"] >= 1, "the winner has a survivor")
	check_eq(HudModel.turn_banner(v).is_empty(), false, "there is a banner to show")
