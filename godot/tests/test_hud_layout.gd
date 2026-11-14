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
	# The winner is named the same way in the banner, the standings and the team panel.
	var names := {}
	for t: Dictionary in v["teams"]:
		names[int(t["index"])] = str(t["name"])
	check_eq(HudModel.turn_banner(v), "%s wins!" % names[2], "the banner uses the team's own name")
	check_eq(rows[0]["name"], names[2], "so do the standings")


func test_crosshair_rides_above_the_centre_by_the_part_of_the_aim_the_camera_skips() -> void:
	check_eq(HudModel.crosshair_offset(0.0, 0.5, 60.0, 720.0), 0.0, "flat aim sits in the middle")
	var up := HudModel.crosshair_offset(30.0, 0.5, 60.0, 720.0)
	check(up < 0.0 and up > -360.0, "aiming up moves it up, within the screen")
	check(HudModel.crosshair_offset(-20.0, 0.5, 60.0, 720.0) > 0.0, "aiming down moves it down")
	check_eq(HudModel.crosshair_offset(40.0, 1.0, 60.0, 720.0), 0.0, "a camera that follows all of it needs no offset")
