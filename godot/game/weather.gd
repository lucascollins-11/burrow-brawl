class_name Weather
extends Node3D
## Rain and storms around the camera: falling streaks slanted by the wind, a rain hiss, and in a
## storm lightning bolts out over the sea with a flash of the whole scene and thunder a moment
## later. Looks and sound only; the sim knows nothing of it (a storm's gusts are server-driven).
##
##   weather.setup(look, env, size_x, size_z, sea_y, density)   # look from MapLook.with_sky
##   weather.update(dt, camera_position, wind)                  # every frame

## Drops per unit of `rain` (1 rain, 2 storm) at density 1.
const DROPS := 2600
## The box of rain around the camera: half width and how high above it the drops start.
const RAIN_REACH := 70.0
const RAIN_TOP := 45.0
const FALL_SPEED := 70.0
## Seconds between lightning strikes in a storm.
const STRIKE_MIN := 5.0
const STRIKE_MAX := 13.0

var rain_amount := 0.0
var lightning := false
var strikes := 0  # how many bolts so far (tests and the playtest report)
var _rain: CPUParticles3D = null
var _hiss: AudioStreamPlayer = null
var _env: MatchEnvironment = null
var _rng := RandomNumberGenerator.new()
var _next_strike := 0.0
var _thunder_in := -1.0
var _thunder_big := false
var _bolt: MeshInstance3D = null
var _bolt_life := 0.0
var _size := Vector2(256, 256)
var _sea_y := 0.0


func setup(look: Dictionary, env: MatchEnvironment, size_x: float, size_z: float, sea_y: float, density := 1.0) -> void:
	for c in get_children():
		c.queue_free()
	_rain = null
	_hiss = null
	_bolt = null
	_env = env
	_size = Vector2(size_x, size_z)
	_sea_y = sea_y
	_rng.randomize()  # looks only
	rain_amount = float(look.get("rain", 0.0))
	lightning = bool(look.get("lightning", false))
	strikes = 0
	_next_strike = _rng.randf_range(2.0, 5.0)
	if rain_amount > 0.0:
		_build_rain(look, density)
		_build_hiss()
	set_process(false)


func _build_rain(look: Dictionary, density: float) -> void:
	_rain = CPUParticles3D.new()
	_rain.name = "Rain"
	_rain.amount = maxi(200, int(DROPS * rain_amount * clampf(density, 0.3, 1.0)))
	_rain.lifetime = (RAIN_TOP + 20.0) / FALL_SPEED
	_rain.preprocess = _rain.lifetime
	_rain.local_coords = false
	_rain.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_rain.emission_box_extents = Vector3(RAIN_REACH, 2.0, RAIN_REACH)
	_rain.direction = Vector3(0, -1, 0)
	_rain.spread = 0.0
	_rain.gravity = Vector3.ZERO
	_rain.initial_velocity_min = FALL_SPEED * 0.9
	_rain.initial_velocity_max = FALL_SPEED * 1.1
	_rain.particle_flag_align_y = true
	var streak := BoxMesh.new()
	streak.size = Vector3(0.035, 1.8 if rain_amount < 1.5 else 2.4, 0.035)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var night := bool(look.get("night", false))
	mat.albedo_color = Color(0.82, 0.88, 1.0, 0.32 if night else 0.45)
	mat.disable_receive_shadows = true
	# Drops right in front of the lens would read as fat white bars: fade them out up close.
	mat.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_ALPHA
	mat.distance_fade_min_distance = 4.0
	mat.distance_fade_max_distance = 14.0
	streak.material = mat
	_rain.mesh = streak
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_rain)


## A soft looped hiss under everything (generated, like every other sound in the game).
func _build_hiss() -> void:
	var secs := 2.0
	var samples := AudioSynth.render(
		{"wave": "noise", "freq": 2800.0, "attack": 0.0, "sustain": secs, "decay": 0.0, "volume": 0.5, "lowpass": 0.35}, 5
	)
	_hiss = AudioStreamPlayer.new()
	_hiss.name = "RainHiss"
	_hiss.stream = AudioSynth.to_stream(samples, AudioSynth.SAMPLE_RATE, true)
	_hiss.bus = "SFX"
	_hiss.volume_db = -20.0 if rain_amount < 1.5 else -15.0
	add_child(_hiss)
	if is_inside_tree() and not _is_muted():
		_hiss.play()


func _is_muted() -> bool:
	var audio := get_node_or_null("/root/Audio")
	return audio != null and bool(audio.get("muted"))


func _ready() -> void:
	if _hiss != null and not _hiss.playing and not _is_muted():
		_hiss.play()


## Keep the rain around the camera, slant it with the wind, and run the storm.
func update(dt: float, camera_pos: Vector3, wind: Vector2) -> void:
	if _rain != null:
		_rain.global_position = camera_pos + Vector3(0, RAIN_TOP, 0)
		# Wind is -100..100 per axis; strong wind leans the rain about 30 degrees.
		var lean := Vector3(wind.x, 0, wind.y) * 0.006
		_rain.direction = (Vector3(0, -1, 0) + lean).normalized()
		if _hiss != null and not _hiss.playing and not _is_muted():
			_hiss.play()
	if lightning:
		_next_strike -= dt
		if _next_strike <= 0.0:
			strike()
			_next_strike = _rng.randf_range(STRIKE_MIN, STRIKE_MAX)
	if _thunder_in >= 0.0:
		_thunder_in -= dt
		if _thunder_in < 0.0:
			_thunder()
	if _bolt != null:
		_bolt_life -= dt
		# Flicker: on, off, on again, then gone.
		_bolt.visible = _bolt_life > 0.0 and fmod(_bolt_life, 0.12) > 0.04
		if _bolt_life <= 0.0:
			_bolt.queue_free()
			_bolt = null


## One lightning strike out over the sea: a jagged bolt, a flash, thunder after a moment.
func strike() -> void:
	strikes += 1
	var centre := Vector3(_size.x * 0.5, _sea_y, _size.y * 0.5)
	var angle := _rng.randf() * TAU
	var dist := _size.length() * 0.5 + _rng.randf_range(60.0, 260.0)
	var foot := centre + Vector3(cos(angle), 0, sin(angle)) * dist
	_make_bolt(foot, _sea_y + _rng.randf_range(150.0, 210.0))
	var near := 1.0 - clampf((dist - _size.length() * 0.5) / 260.0, 0.0, 1.0)
	if _env != null:
		_env.flash(0.55 + 0.45 * near)
	# Sound travels slower than light: farther strikes rumble later.
	_thunder_in = 0.3 + (1.0 - near) * 1.6
	_thunder_big = near > 0.5


func _make_bolt(foot: Vector3, top_y: float) -> void:
	if _bolt != null:
		_bolt.queue_free()
	var im := ImmediateMesh.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.92, 0.95, 1.0)
	mat.emission_enabled = true
	mat.emission = Color(0.75, 0.85, 1.0)
	mat.emission_energy_multiplier = 4.0
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.disable_fog = true
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES, mat)
	var p := Vector3(foot.x, top_y, foot.z)
	var steps := 14
	var width := 2.2
	var path: Array[Vector3] = [p]
	for i in steps:
		p += Vector3(_rng.randf_range(-9, 9), -(top_y - foot.y) / float(steps), _rng.randf_range(-9, 9))
		path.append(p)
	# A flat ribbon facing roughly toward the island centre is plenty at this distance.
	var side := Vector3(foot.z - _size.y * 0.5, 0, _size.x * 0.5 - foot.x).normalized()
	for i in path.size() - 1:
		var a := path[i]
		var b := path[i + 1]
		var w := width * (1.0 - float(i) / float(steps) * 0.6)
		var sa := side * w
		var sb := side * w * 0.9
		for v: Vector3 in [a - sa, a + sa, b + sb, a - sa, b + sb, b - sb]:
			im.surface_add_vertex(v)
	im.surface_end()
	_bolt = MeshInstance3D.new()
	_bolt.name = "Bolt"
	_bolt.mesh = im
	_bolt.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_bolt)
	_bolt_life = 0.32


func _thunder() -> void:
	var audio := get_node_or_null("/root/Audio")
	if audio != null:
		audio.call("play", "thunder", _rng.randf_range(0.85, 1.05), 0.0 if _thunder_big else -6.0, "near" if _thunder_big else "far")
