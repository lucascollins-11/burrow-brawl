class_name GameSettings
extends RefCounted
## Player settings, saved to user://settings.cfg: volumes, window mode, resolution, vsync, quality,
## mouse sensitivity and the key bindings. Every action in ACTIONS lives in the InputMap, so the
## controls read InputMap actions and a rebind takes effect everywhere at once.
##
## State is static so it works without a scene. The Prefs autoload calls boot() once at start-up;
## the settings menu calls the set_* and rebind functions, each of which applies and saves.

const PATH := "user://settings.cfg"

## Every rebindable action. `key` is the default physical key, `alt` a fixed second key that
## cannot be rebound (arrows for walking), `group` the heading in the menu.
const ACTIONS: Array[Dictionary] = [
	{"id": "move_forward", "label": "Walk forward", "key": KEY_W, "alt": KEY_UP, "group": "Move"},
	{"id": "move_back", "label": "Walk back", "key": KEY_S, "alt": KEY_DOWN, "group": "Move"},
	{"id": "move_left", "label": "Walk left", "key": KEY_A, "alt": KEY_LEFT, "group": "Move"},
	{"id": "move_right", "label": "Walk right", "key": KEY_D, "alt": KEY_RIGHT, "group": "Move"},
	{"id": "jump", "label": "Jump", "key": KEY_SPACE, "alt": 0, "group": "Move"},
	{"id": "backflip", "label": "Backflip", "key": KEY_ENTER, "alt": KEY_KP_ENTER, "group": "Move"},
	{"id": "toggle_aim", "label": "Aim mode", "key": KEY_TAB, "alt": 0, "group": "Fight"},
	{"id": "fire", "label": "Hold to charge, release to fire", "key": KEY_F, "alt": 0, "group": "Fight"},
	{"id": "trigger", "label": "Detonate a shot in flight", "key": KEY_R, "alt": 0, "group": "Fight"},
	{"id": "weapon_menu", "label": "Open weapon menu", "key": KEY_Q, "alt": 0, "group": "Fight"},
	{"id": "cancel_aim", "label": "Cancel aim", "key": KEY_ESCAPE, "alt": 0, "group": "Fight"},
	{"id": "weapon_1", "label": "Weapon 1", "key": KEY_1, "alt": 0, "group": "Fight"},
	{"id": "weapon_2", "label": "Weapon 2", "key": KEY_2, "alt": 0, "group": "Fight"},
	{"id": "fuse_down", "label": "Shorter fuse", "key": KEY_Z, "alt": 0, "group": "Fight"},
	{"id": "fuse_up", "label": "Longer fuse", "key": KEY_X, "alt": 0, "group": "Fight"},
	{"id": "skip", "label": "Skip turn", "key": KEY_BACKSPACE, "alt": 0, "group": "Turn"},
	{"id": "skip_follow", "label": "Skip the camera follow", "key": KEY_C, "alt": 0, "group": "Turn"},
	{"id": "pause", "label": "Pause menu", "key": KEY_ESCAPE, "alt": 0, "group": "Turn"},
]

const WINDOW_MODES: Array[String] = ["Windowed", "Borderless", "Fullscreen"]
const RESOLUTIONS: Array[Vector2i] = [
	Vector2i(1280, 720), Vector2i(1366, 768), Vector2i(1600, 900), Vector2i(1920, 1080), Vector2i(2560, 1440),
]
const QUALITIES: Array[String] = ["Low", "Medium", "High"]
const SENSITIVITY_MIN := 0.25
const SENSITIVITY_MAX := 3.0

static var master_volume := 0.8
static var music_volume := 0.5
static var sfx_volume := 1.0
static var window_mode := 0
static var resolution_index := 0
static var vsync := true
static var quality := 2
static var sensitivity := 1.0
static var invert_y := false
## Controller stick aim speed, separate from the mouse. 1.0 turns the aim about 150 degrees a second
## with the stick fully over.
static var stick_sensitivity := 1.0
## The last choices made on the practice setup screen ("random" or a theme id; edge in voxels or 0
## for the server's default; seconds per turn).
static var practice_theme := "random"
static var practice_size := 0
static var practice_turn := 90
## action id -> physical keycode of the main binding.
static var keys: Dictionary = {}
## pad family (PadMap.XBOX...) -> {action id -> pad code}. Each family keeps its own bindings.
static var pad_codes: Dictionary = {}
## "keyboard" or "pad": what was used last. The prompts show that device's names and glyphs.
static var active_device := "keyboard"
## The family of the pad used last (or of the first pad plugged in), whose bindings are live.
static var active_family := PadMap.XBOX
static var _booted := false


# ------------------------------------------------------------------ pure helpers


static func action_def(id: String) -> Dictionary:
	for a in ACTIONS:
		if a["id"] == id:
			return a
	return {}


static func default_pad_codes() -> Dictionary:
	var out := {}
	for family in PadMap.FAMILIES:
		out[family] = PadMap.default_codes()
	return out


static func pad_code(family: String, id: String) -> int:
	if not pad_codes.has(family):
		return int(PadMap.DEFAULTS.get(id, PadMap.NONE))
	return int((pad_codes[family] as Dictionary).get(id, PadMap.DEFAULTS.get(id, PadMap.NONE)))


static func default_keys() -> Dictionary:
	var out := {}
	for a in ACTIONS:
		out[a["id"]] = int(a["key"])
	return out


static func key_label(code: int) -> String:
	if code == 0:
		return "Unbound"
	return OS.get_keycode_string(code)


## "Space jump - Enter backflip": each pair is [action id, what it does], shown with the action's
## current main key, so hint text stays right after a rebind.
static func hint_for(pairs: Array) -> String:
	var parts: PackedStringArray = []
	for pair in pairs:
		parts.append("%s %s" % [Prompts.label_for(str(pair[0])), pair[1]])
	return " - ".join(parts)


## Stick deflection inside this radius is ignored (drift), and the rest is stretched to 0..1.
const STICK_DEADZONE := 0.18
## Aim movement per second at full deflection and 1.0x, in the same pixel units as mouse motion.
const STICK_PIXELS_PER_SECOND := 600.0


## Aim movement for one frame from a right-stick reading (-1..1 on each axis): a radial dead zone,
## a gentle curve so small pushes aim finely, the stick sensitivity, and the invert-Y option.
static func stick_look(raw: Vector2, dt: float) -> Vector2:
	var mag := raw.length()
	if mag <= STICK_DEADZONE:
		return Vector2.ZERO
	var strength := clampf((mag - STICK_DEADZONE) / (1.0 - STICK_DEADZONE), 0.0, 1.0)
	var dir := raw / mag
	var speed := strength * strength * STICK_PIXELS_PER_SECOND * stick_sensitivity * dt
	return Vector2(dir.x * speed, dir.y * speed * (-1.0 if invert_y else 1.0))


## Mouse movement scaled by the sensitivity setting, with the vertical axis flipped if asked.
static func scale_mouse(dx: float, dy: float) -> Vector2:
	return Vector2(dx * sensitivity, dy * sensitivity * (-1.0 if invert_y else 1.0))


## Shadow atlas size, MSAA, glow and scenery prop density for a quality preset (0 low, 1 medium, 2 high).
static func quality_profile(q: int) -> Dictionary:
	match clampi(q, 0, QUALITIES.size() - 1):
		0:
			return {"shadow_atlas": 1024, "msaa": Viewport.MSAA_DISABLED, "glow": false, "props": 0.35}
		1:
			return {"shadow_atlas": 2048, "msaa": Viewport.MSAA_2X, "glow": true, "props": 0.7}
		_:
			return {"shadow_atlas": 4096, "msaa": Viewport.MSAA_4X, "glow": true, "props": 1.0}


## For the environment code: should the glow effect be on?
static func glow_enabled() -> bool:
	return bool(quality_profile(quality)["glow"])


# ------------------------------------------------------------------ boot, load, save


## Load the file, then apply everything. Safe to call more than once.
static func boot() -> void:
	if _booted:
		return
	_booted = true
	load_file()
	apply_all()


static func load_file(path: String = PATH) -> void:
	keys = default_keys()
	pad_codes = default_pad_codes()
	var cfg := ConfigFile.new()
	if cfg.load(path) != OK:
		return
	master_volume = clampf(float(cfg.get_value("audio", "master", master_volume)), 0.0, 1.0)
	music_volume = clampf(float(cfg.get_value("audio", "music", music_volume)), 0.0, 1.0)
	sfx_volume = clampf(float(cfg.get_value("audio", "sfx", sfx_volume)), 0.0, 1.0)
	window_mode = clampi(int(cfg.get_value("video", "window_mode", window_mode)), 0, WINDOW_MODES.size() - 1)
	resolution_index = clampi(int(cfg.get_value("video", "resolution", resolution_index)), 0, RESOLUTIONS.size() - 1)
	vsync = bool(cfg.get_value("video", "vsync", vsync))
	quality = clampi(int(cfg.get_value("video", "quality", quality)), 0, QUALITIES.size() - 1)
	sensitivity = clampf(float(cfg.get_value("input", "sensitivity", sensitivity)), SENSITIVITY_MIN, SENSITIVITY_MAX)
	invert_y = bool(cfg.get_value("input", "invert_y", invert_y))
	stick_sensitivity = clampf(float(cfg.get_value("input", "stick_sensitivity", stick_sensitivity)), SENSITIVITY_MIN, SENSITIVITY_MAX)
	practice_theme = str(cfg.get_value("practice", "theme", practice_theme))
	practice_size = maxi(0, int(cfg.get_value("practice", "size", practice_size)))
	practice_turn = clampi(int(cfg.get_value("practice", "turn", practice_turn)), 15, 90)
	for a in ACTIONS:
		var id: String = a["id"]
		keys[id] = int(cfg.get_value("keys", id, keys[id]))
		for family in PadMap.FAMILIES:
			var codes: Dictionary = pad_codes[family]
			codes[id] = int(cfg.get_value("pad_" + family, id, codes[id]))


static func save_file(path: String = PATH) -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("audio", "master", master_volume)
	cfg.set_value("audio", "music", music_volume)
	cfg.set_value("audio", "sfx", sfx_volume)
	cfg.set_value("video", "window_mode", window_mode)
	cfg.set_value("video", "resolution", resolution_index)
	cfg.set_value("video", "vsync", vsync)
	cfg.set_value("video", "quality", quality)
	cfg.set_value("input", "sensitivity", sensitivity)
	cfg.set_value("input", "invert_y", invert_y)
	cfg.set_value("input", "stick_sensitivity", stick_sensitivity)
	cfg.set_value("practice", "theme", practice_theme)
	cfg.set_value("practice", "size", practice_size)
	cfg.set_value("practice", "turn", practice_turn)
	for id in keys:
		cfg.set_value("keys", id, keys[id])
	for family in pad_codes:
		for id in pad_codes[family]:
			cfg.set_value("pad_" + str(family), id, pad_codes[family][id])
	cfg.save(path)  # best effort; a read-only disk just forgets the settings


static func reset_to_defaults() -> void:
	master_volume = 0.8
	music_volume = 0.5
	sfx_volume = 1.0
	window_mode = 0
	resolution_index = 0
	vsync = true
	quality = 2
	sensitivity = 1.0
	stick_sensitivity = 1.0
	invert_y = false
	keys = default_keys()
	pad_codes = default_pad_codes()
	apply_all()
	save_file()


# ------------------------------------------------------------------ setters (apply and save)


static func set_master_volume(v: float) -> void:
	master_volume = clampf(v, 0.0, 1.0)
	_apply_audio()
	save_file()


static func set_music_volume(v: float) -> void:
	music_volume = clampf(v, 0.0, 1.0)
	_apply_audio()
	save_file()


static func set_sfx_volume(v: float) -> void:
	sfx_volume = clampf(v, 0.0, 1.0)
	_apply_audio()
	save_file()


static func set_window_mode(m: int) -> void:
	window_mode = clampi(m, 0, WINDOW_MODES.size() - 1)
	_apply_display()
	save_file()


static func set_resolution(i: int) -> void:
	resolution_index = clampi(i, 0, RESOLUTIONS.size() - 1)
	_apply_display()
	save_file()


static func set_vsync(on: bool) -> void:
	vsync = on
	_apply_display()
	save_file()


static func set_quality(q: int) -> void:
	quality = clampi(q, 0, QUALITIES.size() - 1)
	_apply_quality()
	save_file()


static func set_sensitivity(s: float) -> void:
	sensitivity = clampf(s, SENSITIVITY_MIN, SENSITIVITY_MAX)
	save_file()


## Remember the practice setup choices.
static func set_practice(theme_id: String, size: int, turn: int) -> void:
	practice_theme = theme_id
	practice_size = maxi(0, size)
	practice_turn = clampi(turn, 15, 90)
	save_file()


static func set_stick_sensitivity(s: float) -> void:
	stick_sensitivity = clampf(s, SENSITIVITY_MIN, SENSITIVITY_MAX)
	save_file()


static func set_invert_y(on: bool) -> void:
	invert_y = on
	save_file()


## Bind `code` (a physical keycode) to an action. If another action already uses that key the two
## swap, so no key is ever left doing two things by accident. Returns the id of the swapped
## action, or "".
static func rebind(id: String, code: int) -> String:
	if action_def(id).is_empty():
		return ""
	if keys.is_empty():
		keys = default_keys()
	var old := int(keys[id])
	var swapped := ""
	for other in keys:
		if other != id and int(keys[other]) == code and not _may_share(id, other):
			keys[other] = old
			swapped = other
	keys[id] = code
	apply_bindings()
	save_file()
	return swapped


## Rebind a pad action in one family. A button already used by another action swaps places with
## it. Returns the id that was swapped, or "".
static func rebind_pad(family: String, id: String, code: int) -> String:
	if not pad_codes.has(family):
		pad_codes[family] = PadMap.default_codes()
	var codes: Dictionary = pad_codes[family]
	var old := int(codes.get(id, PadMap.NONE))
	var swapped := ""
	for other in codes:
		if other != id and int(codes[other]) == code and code != PadMap.NONE:
			codes[other] = old
			swapped = other
	codes[id] = code
	apply_bindings()
	save_file()
	return swapped


static func reset_pad(family: String) -> void:
	pad_codes[family] = PadMap.default_codes()
	apply_bindings()
	save_file()


## Note which device was used last. Switching to a pad of another family makes that family's
## bindings the live ones. Returns true when the prompts need to change.
static func set_active_device(device: String, family := "") -> bool:
	var changed := device != active_device
	active_device = device
	if device == "pad" and family != "" and family != active_family:
		active_family = family
		changed = true
		apply_bindings()
	return changed


static func reset_keys() -> void:
	keys = default_keys()
	apply_bindings()
	save_file()


## Escape is both "cancel aim" and "pause": cancelling only happens while aiming, so they may share.
static func _may_share(a: String, b: String) -> bool:
	return (a == "pause" and b == "cancel_aim") or (a == "cancel_aim" and b == "pause")


# ------------------------------------------------------------------ applying


static func apply_all() -> void:
	apply_bindings()
	_apply_audio()
	_apply_display()
	_apply_quality()


## Make sure every action exists in the InputMap and carries its current keys.
static func apply_bindings() -> void:
	if keys.is_empty():
		keys = default_keys()
	for a in ACTIONS:
		var id: String = a["id"]
		if not InputMap.has_action(id):
			InputMap.add_action(id)
		InputMap.action_erase_events(id)
		var code := int(keys.get(id, a["key"]))
		if code != 0:
			InputMap.action_add_event(id, _key_event(code))
		var alt := int(a["alt"])
		if alt != 0:
			InputMap.action_add_event(id, _key_event(alt))
		var pad := PadMap.event_for(pad_code(active_family, id))
		if pad != null:
			InputMap.action_add_event(id, pad)
		InputMap.action_set_deadzone(id, 0.5)
	# The left stick walks, in eight directions like the keys.
	for walk: Array in PadMap.WALK_AXES:
		var m := InputEventJoypadMotion.new()
		m.axis = int(walk[1]) as JoyAxis
		m.axis_value = float(walk[2])
		InputMap.action_add_event(str(walk[0]), m)


static func _key_event(code: int) -> InputEventKey:
	var ev := InputEventKey.new()
	ev.physical_keycode = code as Key
	return ev


static func _audio() -> Node:
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).root.get_node_or_null("Audio")
	return null


static func _apply_audio() -> void:
	var audio := _audio()
	if audio == null:
		return
	audio.call("set_master_volume", master_volume)
	audio.call("set_music_volume", music_volume)
	audio.call("set_sfx_volume", sfx_volume)


static func _apply_display() -> void:
	if DisplayServer.get_name() == "headless":
		return
	DisplayServer.window_set_vsync_mode(
		DisplayServer.VSYNC_ENABLED if vsync else DisplayServer.VSYNC_DISABLED
	)
	match window_mode:
		1:
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
			DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
			DisplayServer.window_set_size(DisplayServer.screen_get_size())
			DisplayServer.window_set_position(DisplayServer.screen_get_position())
		2:
			DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, false)
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
		_:
			DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, false)
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
			var size := RESOLUTIONS[resolution_index]
			DisplayServer.window_set_size(size)
			var screen := DisplayServer.screen_get_size()
			DisplayServer.window_set_position(DisplayServer.screen_get_position() + (screen - size) / 2)


static func _apply_quality() -> void:
	if DisplayServer.get_name() == "headless":
		return
	var profile := quality_profile(quality)
	RenderingServer.directional_shadow_atlas_set_size(int(profile["shadow_atlas"]), true)
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		(loop as SceneTree).root.msaa_3d = int(profile["msaa"]) as Viewport.MSAA
