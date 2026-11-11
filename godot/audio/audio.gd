extends Node
## Audio autoload (name: Audio). Plays the generated sound effects and music loops.
##
## One call per sim event: Audio.on_event(ev) with an event from the view protocol (fired,
## explosion, bounced, jumped, landed, damage, died, projectileLost). Other calls: on_turn_start(),
## on_timer(seconds_left), play(name), play_music("menu" | "match"), stop_music(). Every Button
## that enters the tree gets click and hover sounds automatically.
##
## Volume settings (0..1) are kept in user://audio.cfg: set_master_volume, set_sfx_volume,
## set_music_volume, set_muted. Everything is generated in code, see art/CREDITS.md.

const SETTINGS_PATH := "user://audio.cfg"
const SFX_BUS := "SFX"
const MUSIC_BUS := "Music"
const VOICES := 10
## A landing shorter than this many voxels is just a step, not a thud.
const LAND_MIN_FALL := 3.0
const TICK_FROM_SECONDS := 5

var master_volume := 0.8
var sfx_volume := 1.0
var music_volume := 0.5
var muted := false

var _streams: Dictionary = {}  # key -> AudioStreamWAV
var _voices: Array[AudioStreamPlayer] = []
var _next_voice := 0
var _music: AudioStreamPlayer
var _music_track := ""
var _last_tick := -1
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()  # pitch variation only; audio never touches the simulation
	_load_settings()
	_setup_buses()
	for i in range(VOICES):
		var p := AudioStreamPlayer.new()
		p.bus = SFX_BUS
		add_child(p)
		_voices.append(p)
	_music = AudioStreamPlayer.new()
	_music.bus = MUSIC_BUS
	add_child(_music)
	_apply_volumes()
	get_tree().node_added.connect(_on_node_added)


# ------------------------------------------------------------------ events


## What to play for a sim event: a list of {name, pitch, volume_db, variant}. Pure, so it is easy
## to test. Unknown events give an empty list.
static func plan_event(ev: Dictionary) -> Array:
	var out: Array = []
	match str(ev.get("type", "")):
		"fired":
			out.append({"name": "fire"})
		"explosion":
			var edit: Dictionary = ev.get("edit", {})
			var radius := float(edit.get("r", 4.0))
			out.append(
				{
					"name": "explosion",
					"variant": SfxRecipes.size_for_radius(radius),
					# Bigger blasts are a little lower.
					"pitch": clampf(1.15 - radius * 0.03, 0.75, 1.1),
				}
			)
		"bounced":
			out.append({"name": "bounce"})
		"jumped":
			out.append({"name": "jump", "pitch": 1.25 if bool(ev.get("backflip", false)) else 1.0})
		"landed":
			if float(ev.get("fallDistance", 0.0)) >= LAND_MIN_FALL:
				out.append({"name": "land"})
		"damage":
			if str(ev.get("cause", "")) != "water":
				var amount := float(ev.get("amount", 10.0))
				out.append({"name": "hurt", "pitch": clampf(1.3 - amount / 120.0, 0.8, 1.3)})
		"died":
			if str(ev.get("cause", "")) == "water":
				out.append({"name": "splash"})
			out.append({"name": "knockout"})
		"projectileLost":
			out.append({"name": "splash", "volume_db": -6.0})
	return out


func on_event(ev: Dictionary) -> void:
	for step in plan_event(ev):
		play(str(step["name"]), float(step.get("pitch", 1.0)), float(step.get("volume_db", 0.0)), str(step.get("variant", "")))


func on_events(events: Array) -> void:
	for ev in events:
		on_event(ev)


func on_turn_start() -> void:
	_last_tick = -1
	play("turn_start")


## Call every frame (or whenever it changes) with the seconds left in the turn.
func on_timer(seconds_left: float) -> void:
	var whole := ceili(seconds_left)
	if whole == _last_tick:
		return
	_last_tick = whole
	if whole >= 1 and whole <= TICK_FROM_SECONDS:
		play("tick", 1.0 + float(TICK_FROM_SECONDS - whole) * 0.05)


func ui_click() -> void:
	play("ui_click")


func ui_confirm() -> void:
	play("ui_confirm")


# ------------------------------------------------------------------ playback


## Play a named effect. `variant` picks a recipe size (explosions). `pitch` is a rate multiplier.
func play(sfx: String, pitch: float = 1.0, volume_db: float = 0.0, variant: String = "") -> void:
	if muted or _voices.is_empty():
		return
	var stream := _stream_for(sfx, variant)
	if stream == null:
		return
	var voice := _voices[_next_voice]
	_next_voice = (_next_voice + 1) % _voices.size()
	voice.stream = stream
	voice.pitch_scale = pitch * (1.0 + _rng.randf_range(-0.05, 0.05))
	voice.volume_db = volume_db
	voice.play()


func _stream_for(sfx: String, variant: String) -> AudioStreamWAV:
	var key := sfx if variant == "" else "%s/%s" % [sfx, variant]
	if _streams.has(key):
		return _streams[key]
	var samples := SfxRecipes.make(sfx, variant)
	if samples.is_empty():
		return null
	var stream := AudioSynth.to_stream(samples)
	_streams[key] = stream
	return stream


## Generate the effects up front so the first shot does not stutter. Safe to call more than once.
func preload_all() -> void:
	for sfx_name in SfxRecipes.NAMES:
		_stream_for(sfx_name, "")
	for size in SfxRecipes.EXPLOSION_SIZES:
		_stream_for("explosion", size)


func play_music(track: String) -> void:
	if track == _music_track:
		return
	_music_track = track
	if track == "":
		_music.stop()
		return
	var key := "music/" + track
	if not _streams.has(key):
		_streams[key] = MusicSynth.stream(track)
	_music.stream = _streams[key]
	if not muted:
		_music.play()


func stop_music() -> void:
	play_music("")


func current_music() -> String:
	return _music_track


# ------------------------------------------------------------------ settings


func set_master_volume(v: float) -> void:
	master_volume = clampf(v, 0.0, 1.0)
	_apply_volumes()
	_save_settings()


func set_sfx_volume(v: float) -> void:
	sfx_volume = clampf(v, 0.0, 1.0)
	_apply_volumes()
	_save_settings()


func set_music_volume(v: float) -> void:
	music_volume = clampf(v, 0.0, 1.0)
	_apply_volumes()
	_save_settings()


func set_muted(m: bool) -> void:
	muted = m
	_apply_volumes()
	_save_settings()
	if m:
		for voice in _voices:
			voice.stop()
	elif _music_track != "" and not _music.playing:
		_music.play()


## 0..1 volume to decibels, with silence at 0.
static func to_db(v: float) -> float:
	return -80.0 if v <= 0.0001 else linear_to_db(v)


func _setup_buses() -> void:
	for bus_name in [SFX_BUS, MUSIC_BUS]:
		if AudioServer.get_bus_index(bus_name) < 0:
			AudioServer.add_bus()
			var idx := AudioServer.bus_count - 1
			AudioServer.set_bus_name(idx, bus_name)
			AudioServer.set_bus_send(idx, "Master")


func _apply_volumes() -> void:
	AudioServer.set_bus_volume_db(0, -80.0 if muted else to_db(master_volume))
	var sfx := AudioServer.get_bus_index(SFX_BUS)
	var music := AudioServer.get_bus_index(MUSIC_BUS)
	if sfx >= 0:
		AudioServer.set_bus_volume_db(sfx, to_db(sfx_volume))
	if music >= 0:
		AudioServer.set_bus_volume_db(music, to_db(music_volume))


func _load_settings() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SETTINGS_PATH) != OK:
		return
	master_volume = clampf(float(cfg.get_value("audio", "master", master_volume)), 0.0, 1.0)
	sfx_volume = clampf(float(cfg.get_value("audio", "sfx", sfx_volume)), 0.0, 1.0)
	music_volume = clampf(float(cfg.get_value("audio", "music", music_volume)), 0.0, 1.0)
	muted = bool(cfg.get_value("audio", "muted", muted))


func _save_settings() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("audio", "master", master_volume)
	cfg.set_value("audio", "sfx", sfx_volume)
	cfg.set_value("audio", "music", music_volume)
	cfg.set_value("audio", "muted", muted)
	cfg.save(SETTINGS_PATH)  # best effort; a read-only disk just forgets the setting


func _on_node_added(node: Node) -> void:
	if node is BaseButton:
		var b: BaseButton = node
		b.pressed.connect(ui_click)
		b.mouse_entered.connect(play.bind("ui_hover"))
