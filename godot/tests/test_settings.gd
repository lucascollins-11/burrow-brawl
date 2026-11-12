extends TestCase

const TMP := "user://test_settings.cfg"


func _reset() -> void:
	GameSettings.keys = GameSettings.default_keys()
	GameSettings.sensitivity = 1.0
	GameSettings.invert_y = false
	GameSettings.apply_bindings()


func test_every_action_is_in_the_input_map_with_its_default_key() -> void:
	_reset()
	for a in GameSettings.ACTIONS:
		check(InputMap.has_action(a["id"]), "%s is an action" % a["id"])
	var ev := InputEventKey.new()
	ev.physical_keycode = KEY_W
	ev.pressed = true
	check(ev.is_action("move_forward"), "W walks forward")
	ev.physical_keycode = KEY_UP
	check(ev.is_action("move_forward"), "the arrow is a fixed second key")


func test_rebinding_moves_the_key_and_swaps_with_a_clash() -> void:
	_reset()
	var swapped := GameSettings.rebind("jump", KEY_Q)
	check_eq(swapped, "", "Q was free")
	var ev := InputEventKey.new()
	ev.physical_keycode = KEY_Q
	check(ev.is_action("jump"), "Q jumps now")
	ev.physical_keycode = KEY_SPACE
	check(not ev.is_action("jump"), "Space no longer jumps")
	# Take W for jump: forward gets jump's old key, Q.
	swapped = GameSettings.rebind("jump", KEY_W)
	check_eq(swapped, "move_forward", "clash swaps")
	check_eq(GameSettings.keys["move_forward"], KEY_Q, "forward got the old key")
	_reset()


func test_escape_may_cancel_aim_and_pause() -> void:
	_reset()
	check_eq(GameSettings.rebind("pause", KEY_ESCAPE), "", "no swap for the shared key")
	check_eq(GameSettings.keys["cancel_aim"], KEY_ESCAPE, "cancel keeps Escape")


func test_settings_round_trip_through_the_file() -> void:
	_reset()
	GameSettings.master_volume = 0.3
	GameSettings.window_mode = 2
	GameSettings.quality = 0
	GameSettings.sensitivity = 2.0
	GameSettings.invert_y = true
	GameSettings.keys["jump"] = KEY_J
	GameSettings.save_file(TMP)
	GameSettings.master_volume = 0.8
	GameSettings.window_mode = 0
	GameSettings.quality = 2
	GameSettings.sensitivity = 1.0
	GameSettings.invert_y = false
	GameSettings.load_file(TMP)
	check_eq(GameSettings.master_volume, 0.3, "volume")
	check_eq(GameSettings.window_mode, 2, "window mode")
	check_eq(GameSettings.quality, 0, "quality")
	check_eq(GameSettings.sensitivity, 2.0, "sensitivity")
	check(GameSettings.invert_y, "invert")
	check_eq(GameSettings.keys["jump"], KEY_J, "binding")
	check_eq(GameSettings.keys["fire"], KEY_F, "unchanged binding keeps its default")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TMP))
	GameSettings.master_volume = 0.8
	GameSettings.window_mode = 0
	GameSettings.quality = 2
	_reset()


func test_mouse_scaling_follows_sensitivity_and_invert() -> void:
	_reset()
	GameSettings.sensitivity = 2.0
	check_eq(GameSettings.scale_mouse(3.0, 4.0), Vector2(6.0, 8.0), "scaled")
	GameSettings.invert_y = true
	check_eq(GameSettings.scale_mouse(3.0, 4.0), Vector2(6.0, -8.0), "inverted y")
	_reset()


func test_quality_presets_get_lighter_towards_low() -> void:
	var low := GameSettings.quality_profile(0)
	var high := GameSettings.quality_profile(2)
	check(int(low["shadow_atlas"]) < int(high["shadow_atlas"]), "smaller shadows on low")
	check(not bool(low["glow"]) and bool(high["glow"]), "glow only above low")
	check_eq(GameSettings.quality_profile(99)["shadow_atlas"], high["shadow_atlas"], "out of range clamps")


func test_controls_read_the_rebound_walk_keys() -> void:
	_reset()
	var c := Controls.new()
	check_eq(c.axes(), Vector2i.ZERO, "nothing held")
	c.free()


func test_menu_builds_with_a_button_for_every_action() -> void:
	_reset()
	var menu := SettingsMenu.new()
	menu._ready()
	check_eq(menu._key_buttons.size(), GameSettings.ACTIONS.size(), "one key button per action")
	check_eq((menu._key_buttons["jump"] as Button).text, "Space", "shows the bound key")
	menu.free()


<<<<<<< HEAD
func test_pause_menu_opens_toggles_and_leaves() -> void:
	var pause := PauseMenu.new()
	pause._ready()
	check(not pause.is_open(), "starts closed")
	pause.toggle()
	check(pause.is_open(), "toggle opens")
	pause.toggle()
	check(not pause.is_open(), "toggle closes")
	pause.open()
	pause._open_settings()
	check(not pause._menu_column.visible, "settings replace the pause buttons")
	pause.toggle()
	check(pause.is_open() and pause._menu_column.visible, "toggle backs out of settings first")
	pause.free()
=======
func test_hint_text_follows_rebinding() -> void:
	_reset()
	var pairs := [["jump", "jump"], ["skip", "skip"]]
	check_eq(GameSettings.hint_for(pairs), "Space jump - Backspace skip", "defaults")
	GameSettings.rebind("skip", KEY_K)
	check_eq(GameSettings.hint_for(pairs), "Space jump - K skip", "skip rebound")
	_reset()
>>>>>>> d1-settings
