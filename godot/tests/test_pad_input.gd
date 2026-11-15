extends TestCase

const TMP := "user://test_pad_settings.cfg"


func _reset() -> void:
	GameSettings.keys = GameSettings.default_keys()
	GameSettings.pad_codes = GameSettings.default_pad_codes()
	GameSettings.active_device = "keyboard"
	GameSettings.active_family = PadMap.XBOX
	GameSettings.apply_bindings()


func _pad_button(index: int) -> InputEventJoypadButton:
	var ev := InputEventJoypadButton.new()
	ev.button_index = index as JoyButton
	ev.pressed = true
	return ev


func _trigger(axis: int, value: float) -> InputEventJoypadMotion:
	var ev := InputEventJoypadMotion.new()
	ev.axis = axis as JoyAxis
	ev.axis_value = value
	return ev


func test_pads_are_sorted_into_families_by_name() -> void:
	check_eq(PadMap.family_for_name("Xbox 360 Controller"), PadMap.XBOX, "xbox 360")
	check_eq(PadMap.family_for_name("XInput Gamepad"), PadMap.XBOX, "unknown names fall back to xbox")
	check_eq(PadMap.family_for_name("PS5 Controller"), PadMap.PLAYSTATION, "ps5")
	check_eq(PadMap.family_for_name("DualSense Wireless Controller"), PadMap.PLAYSTATION, "dualsense")
	check_eq(PadMap.family_for_name("Sony DualShock 4"), PadMap.PLAYSTATION, "dualshock")
	check_eq(PadMap.family_for_name("Nintendo Switch Pro Controller"), PadMap.SWITCH, "switch pro")
	check_eq(PadMap.family_for_name("Pro Controller"), PadMap.SWITCH, "bare pro controller")


func test_face_buttons_are_named_per_family() -> void:
	check_eq(PadMap.button_name(PadMap.XBOX, JOY_BUTTON_A), "A", "xbox bottom")
	check_eq(PadMap.button_name(PadMap.PLAYSTATION, JOY_BUTTON_A), "Cross", "playstation bottom")
	check_eq(PadMap.button_name(PadMap.SWITCH, JOY_BUTTON_A), "B", "switch bottom is B")
	check_eq(PadMap.button_name(PadMap.SWITCH, JOY_BUTTON_B), "A", "switch right is A")
	check_eq(PadMap.button_name(PadMap.PLAYSTATION, JOY_BUTTON_Y), "Triangle", "playstation top")
	check_eq(PadMap.button_name(PadMap.XBOX, PadMap.TRIGGER_RIGHT), "RT", "xbox trigger")
	check_eq(PadMap.button_name(PadMap.PLAYSTATION, PadMap.TRIGGER_RIGHT), "R2", "playstation trigger")
	check_eq(PadMap.button_name(PadMap.SWITCH, PadMap.TRIGGER_LEFT), "ZL", "switch trigger")
	check_eq(PadMap.button_name(PadMap.PLAYSTATION, JOY_BUTTON_START), "Options", "playstation start")


func test_every_action_has_a_default_and_no_two_share_a_button() -> void:
	var seen := {}
	for a in GameSettings.ACTIONS:
		var id: String = a["id"]
		check(PadMap.DEFAULTS.has(id), "pad default for " + id)
		var code := int(PadMap.DEFAULTS[id])
		if id.begins_with("move_"):
			check_eq(code, PadMap.NONE, id + " is on the stick, not a button")
			continue
		check(PadMap.BINDABLE.has(code), "%s default %d is a bindable button" % [id, code])
		check(not seen.has(code), "%s shares button %d with %s" % [id, code, seen.get(code, "")])
		seen[code] = id


func test_defaults_reach_the_input_map_and_the_left_stick_walks() -> void:
	_reset()
	var found_a := false
	for ev in InputMap.action_get_events("jump"):
		if ev is InputEventJoypadButton and (ev as InputEventJoypadButton).button_index == JOY_BUTTON_A:
			found_a = true
	check(found_a, "jump has the A button")
	var fire_axis := -1
	for ev in InputMap.action_get_events("fire"):
		if ev is InputEventJoypadMotion:
			fire_axis = int((ev as InputEventJoypadMotion).axis)
	check_eq(fire_axis, JOY_AXIS_TRIGGER_RIGHT, "fire is the right trigger")
	var walk_axis := -1
	for ev in InputMap.action_get_events("move_forward"):
		if ev is InputEventJoypadMotion:
			walk_axis = int((ev as InputEventJoypadMotion).axis)
	check_eq(walk_axis, JOY_AXIS_LEFT_Y, "the left stick walks forward")
	check(InputMap.action_get_events("jump").size() >= 2, "keyboard binding is still there")
	_reset()


func test_rebinding_a_pad_button_swaps_and_keeps_families_apart() -> void:
	_reset()
	var swapped := GameSettings.rebind_pad(PadMap.PLAYSTATION, "jump", JOY_BUTTON_B)
	check_eq(swapped, "backflip", "jump took backflip's button")
	check_eq(GameSettings.pad_code(PadMap.PLAYSTATION, "jump"), JOY_BUTTON_B, "jump moved")
	check_eq(GameSettings.pad_code(PadMap.PLAYSTATION, "backflip"), JOY_BUTTON_A, "backflip got jump's old button")
	check_eq(GameSettings.pad_code(PadMap.XBOX, "jump"), JOY_BUTTON_A, "xbox is untouched")
	GameSettings.reset_pad(PadMap.PLAYSTATION)
	check_eq(GameSettings.pad_code(PadMap.PLAYSTATION, "jump"), JOY_BUTTON_A, "reset to defaults")
	_reset()


func test_the_live_bindings_follow_the_pad_in_use() -> void:
	_reset()
	GameSettings.pad_codes[PadMap.SWITCH]["jump"] = JOY_BUTTON_X
	check(GameSettings.set_active_device("pad", PadMap.SWITCH), "changing family is a change")
	var button := -1
	for ev in InputMap.action_get_events("jump"):
		if ev is InputEventJoypadButton:
			button = int((ev as InputEventJoypadButton).button_index)
	check_eq(button, JOY_BUTTON_X, "the switch binding is live")
	check(not GameSettings.set_active_device("pad", PadMap.SWITCH), "same device again is no change")
	check(GameSettings.set_active_device("keyboard"), "back to the keyboard")
	_reset()


func test_pad_bindings_round_trip_through_the_file() -> void:
	_reset()
	GameSettings.pad_codes[PadMap.XBOX]["fire"] = JOY_BUTTON_LEFT_SHOULDER
	GameSettings.pad_codes[PadMap.SWITCH]["jump"] = PadMap.TRIGGER_LEFT
	GameSettings.save_file(TMP)
	GameSettings.pad_codes = GameSettings.default_pad_codes()
	GameSettings.load_file(TMP)
	check_eq(GameSettings.pad_code(PadMap.XBOX, "fire"), JOY_BUTTON_LEFT_SHOULDER, "xbox fire")
	check_eq(GameSettings.pad_code(PadMap.SWITCH, "jump"), PadMap.TRIGGER_LEFT, "switch jump")
	check_eq(GameSettings.pad_code(PadMap.PLAYSTATION, "jump"), JOY_BUTTON_A, "other families keep defaults")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TMP))
	_reset()


func test_pad_events_become_match_actions() -> void:
	_reset()
	var c := Controls.new()
	c.handle_event(_pad_button(JOY_BUTTON_A))
	c.handle_event(_pad_button(JOY_BUTTON_B))
	check_eq(c._actions, ["jump", "backflip"], "A jumps, B backflips")
	c._actions.clear()
	# The right trigger: pulling past halfway presses fire once however many motion events arrive,
	# and letting go releases it.
	c.handle_event(_trigger(JOY_AXIS_TRIGGER_RIGHT, 0.7))
	c.handle_event(_trigger(JOY_AXIS_TRIGGER_RIGHT, 0.9))
	c.handle_event(_trigger(JOY_AXIS_TRIGGER_RIGHT, 1.0))
	check_eq(c._actions, ["fire_down"], "one press")
	c.handle_event(_trigger(JOY_AXIS_TRIGGER_RIGHT, 0.0))
	check_eq(c._actions, ["fire_down", "fire_up"], "release fires the charge")
	c.free()
	_reset()


func test_a_rebound_button_drives_the_action() -> void:
	_reset()
	GameSettings.rebind_pad(PadMap.XBOX, "fire", JOY_BUTTON_X)
	var c := Controls.new()
	var press := _pad_button(JOY_BUTTON_X)
	c.handle_event(press)
	check(c._actions.has("fire_down"), "X now charges the shot")
	check(not c._actions.has("toggle_aim"), "and no longer toggles aim (swapped away)")
	c.free()
	GameSettings.reset_pad(PadMap.XBOX)
	_reset()


func test_event_codes() -> void:
	check_eq(PadMap.code_for_event(_pad_button(JOY_BUTTON_Y)), JOY_BUTTON_Y, "button")
	check_eq(PadMap.code_for_event(_trigger(JOY_AXIS_TRIGGER_LEFT, 0.9)), PadMap.TRIGGER_LEFT, "trigger")
	check_eq(PadMap.code_for_event(_trigger(JOY_AXIS_TRIGGER_LEFT, 0.2)), PadMap.NONE, "a light pull is nothing")
	check_eq(PadMap.code_for_event(_trigger(JOY_AXIS_LEFT_X, 1.0)), PadMap.NONE, "sticks are not bindable")
	check(PadMap.is_pad_input(_trigger(JOY_AXIS_LEFT_X, 0.9)), "a pushed stick is pad use")
	check(not PadMap.is_pad_input(_trigger(JOY_AXIS_LEFT_X, 0.1)), "stick drift is not")


func test_prompts_follow_the_last_used_device() -> void:
	_reset()
	check_eq(Prompts.label_for("jump"), "Space", "keyboard")
	check_eq(Prompts.aim_phrase(), "Move the mouse to aim", "keyboard aim phrase")
	GameSettings.set_active_device("pad", PadMap.PLAYSTATION)
	check_eq(Prompts.plain(Prompts.label_for("jump")), "Cross", "playstation jump")
	check_eq(Prompts.plain(Prompts.label_for("fire")), "R2", "playstation fire")
	GameSettings.set_active_device("pad", PadMap.SWITCH)
	check_eq(Prompts.plain(Prompts.label_for("jump")), "B", "switch jump is its B")
	check_eq(Prompts.plain(Prompts.label_for("fire")), "ZR", "switch fire")
	GameSettings.set_active_device("pad", PadMap.XBOX)
	check_eq(Prompts.plain(Prompts.label_for("jump")), "A", "xbox jump")
	check_eq(Prompts.plain(Prompts.walk_label()), "Left stick", "walk is the stick")
	check_eq(
		Prompts.plain(GameSettings.hint_for([["jump", "jump"], ["backflip", "backflip"]])),
		"A jump - B backflip",
		"hint text with glyph names",
	)
	GameSettings.set_active_device("keyboard")
	check_eq(GameSettings.hint_for([["jump", "jump"], ["backflip", "backflip"]]), "Space jump - Enter backflip", "back to keys")
	_reset()


func test_prompt_tokens_parse() -> void:
	var segs := Prompts.parse("Press {pad:xbox:0} or {pad:playstation:105} to go")
	check_eq(segs.size(), 5, "text, glyph, text, glyph, text")
	check_eq(segs[1], {"family": "xbox", "code": 0}, "first glyph")
	check_eq(segs[3], {"family": "playstation", "code": 105}, "second glyph")
	check_eq(Prompts.plain("Press {pad:xbox:0} or {pad:playstation:105} to go"), "Press A or R2 to go", "plain")
	check_eq(Prompts.plain("no tokens {here}"), "no tokens {here}", "ordinary braces pass through")


func test_every_glyph_draws() -> void:
	for family in PadMap.FAMILIES:
		var codes: Array = PadMap.BINDABLE.duplicate()
		codes.append(PadMap.LEFT_STICK)
		codes.append(PadMap.RIGHT_STICK)
		for code: int in codes:
			var tex := PadGlyphs.texture(family, code)
			check(tex != null and tex.get_width() == PadGlyphs.SIZE, "%s %d has a texture" % [family, code])
			var img := tex.get_image()
			var opaque := 0
			for y in range(0, img.get_height(), 4):
				for x in range(0, img.get_width(), 4):
					if img.get_pixel(x, y).a > 0.5:
						opaque += 1
			check(opaque > 20, "%s %d is not blank (%d opaque samples)" % [family, code, opaque])


func test_prompt_label_shows_glyph_tokens() -> void:
	var label := PromptLabel.new()
	label.set_prompt("Press {pad:xbox:0} to jump")
	check_eq(label.shown_plain(), "Press A to jump", "text with a glyph")
	check_eq(label.get_parsed_text().strip_edges().contains("Press"), true, "label holds the text")
	label.free()


func test_settings_menu_has_a_tab_and_button_per_pad_family() -> void:
	_reset()
	var menu := SettingsMenu.new()
	menu._ready()
	check_eq(menu._tabs.get_tab_count(), 7, "sound, video, controls, camera and three pad tabs")
	var rebindable := 0
	for a in GameSettings.ACTIONS:
		if not String(a["id"]).begins_with("move_"):
			rebindable += 1
	check_eq(menu._pad_buttons.size(), rebindable * PadMap.FAMILIES.size(), "a button per action per family")
	check_eq((menu._pad_buttons["playstation:jump"] as Button).text, "Cross", "shows the pad's own name")
	check_eq((menu._pad_buttons["switch:fire"] as Button).text, "ZR", "switch trigger")
	check((menu._pad_buttons["xbox:jump"] as Button).icon != null, "and its glyph")
	# Pressing a button on the pad while rebinding sets the binding.
	menu._start_pad_rebinding(PadMap.XBOX, "jump")
	menu._input_pad_rebind(_pad_button(JOY_BUTTON_Y))
	check_eq(GameSettings.pad_code(PadMap.XBOX, "jump"), JOY_BUTTON_Y, "jump rebound from the pad")
	check_eq((menu._pad_buttons["xbox:jump"] as Button).text, "Y", "button shows the new binding")
	menu.free()
	GameSettings.reset_pad(PadMap.XBOX)
	_reset()
