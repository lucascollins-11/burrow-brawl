class_name Weather
extends Node3D
## Rain and storms around the camera: falling streaks slanted by the wind, a rain hiss, and in a
## storm lightning bolts out over the sea with a flash of the whole scene and thunder a moment
## later. Fog is banks of low cloud drifting over the ground with clear air between them, so the
## island stays playable. Looks and sound only; the sim knows nothing of it (a storm's gusts are
## server-driven).
##
##   weather.setup(look, env, size_x, size_z, sea_y, density, ground_y)   # look from MapLook.with_sky
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
## Fog banks at density 1, and puffs per bank.
const FOG_BANKS := 14
const FOG_PUFFS := 9
## Drift in world units a second with no wind; wind adds to it.
const FOG_DRIFT := 2.5

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
var _ground := Callable()
var _fog: MultiMeshInstance3D = null
## Per bank: {centre: Vector3, puffs: [[offset: Vector3, size: float]]}
var _banks: Array = []
var _drift := Vector2(1, 0.35).normalized()
## Where each fog puff is now (the MultiMesh keeps its copy on the render server).
var fog_puffs := PackedVector3Array()


func setup(look: Dictionary, env: MatchEnvironment, size_x: float, size_z: float, sea_y: float, density := 1.0, ground_y := Callable()) -> void:
	for c in get_children():
		c.queue_free()
	_rain = null
	_hiss = null
	_bolt = null
	_fog = null
	_banks.clear()
	fog_puffs.clear()
	_ground = ground_y
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
	if float(look.get("fog_banks", 0.0)) > 0.0:
		_build_fog(look, density)
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


## Fog banks: clusters of soft billboard puffs a few units over the ground, one MultiMesh for all.
func _build_fog(look: Dictionary, density: float) -> void:
	var tex := GradientTexture2D.new()
	tex.width = 64
	tex.height = 64
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	g.add_point(0.45, Color(1, 1, 1, 0.55))
	tex.gradient = g
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.billboard_keep_scale = true
	mat.albedo_texture = tex
	# Light the banks a little brighter than the haze so they read as clouds; moonlit at night.
	var night := bool(look.get("night", false))
	var tint := MapLook.color(look, "fog").lerp(Color(0.5, 0.56, 0.72) if night else Color.WHITE, 0.6 if night else 0.4)
	mat.albedo_color = Color(tint.r, tint.g, tint.b, 0.6 if night else 0.55)
	mat.disable_receive_shadows = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	# A puff right on the lens would white the screen out: fade it as the camera gets close.
	mat.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_ALPHA
	mat.distance_fade_min_distance = 6.0
	mat.distance_fade_max_distance = 40.0
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	quad.material = mat
	var banks := maxi(5, int(round(FOG_BANKS * clampf(density, 0.4, 1.0) * clampf(_size.length() / 362.0, 0.7, 1.8))))
	for i in banks:
		var puffs: Array = []
		var spread := _rng.randf_range(16.0, 30.0)
		for j in FOG_PUFFS:
			var a := _rng.randf() * TAU
			var r := sqrt(_rng.randf()) * spread
			puffs.append([Vector3(cos(a) * r * 1.4, _rng.randf_range(0.0, 5.0), sin(a) * r), _rng.randf_range(14.0, 30.0)])
		var centre := Vector3(_rng.randf_range(-40.0, _size.x + 40.0), 0.0, _rng.randf_range(-40.0, _size.y + 40.0))
		_banks.append({"centre": centre, "puffs": puffs})
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = quad
	mm.instance_count = banks * FOG_PUFFS
	_fog = MultiMeshInstance3D.new()
	_fog.name = "FogBanks"
	_fog.multimesh = mm
	_fog.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_fog)
	_place_fog()


func fog_bank_count() -> int:
	return _banks.size()


func _ground_at(x: float, z: float) -> float:
	var y := _sea_y
	if _ground.is_valid():
		y = maxf(y, float(_ground.call(x, z)))
	return y


## Every puff sits a little over the ground under it, so the banks roll up and over the hills.
func _place_fog() -> void:
	var mm := _fog.multimesh
	fog_puffs.resize(mm.instance_count)
	var k := 0
	for b: Dictionary in _banks:
		var c: Vector3 = b["centre"]
		for p: Array in b["puffs"]:
			var off: Vector3 = p[0]
			var size: float = p[1]
			var x := c.x + off.x
			var z := c.z + off.z
			var y := _ground_at(x, z) + size * 0.22 + off.y
			fog_puffs[k] = Vector3(x, y, z)
			mm.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3(size * 1.6, size, 1.0)), fog_puffs[k]))
			k += 1


## Banks drift downwind (a gentle breeze when there is none) and wrap round the island.
func _drift_fog(dt: float, wind: Vector2) -> void:
	if wind.length() > 2.0:
		_drift = _drift.lerp(wind.normalized(), clampf(dt * 0.2, 0.0, 1.0)).normalized()
	var speed := FOG_DRIFT + wind.length() * 0.06
	var lo := Vector2(-70.0, -70.0)
	var hi := _size + Vector2(70.0, 70.0)
	for b: Dictionary in _banks:
		var c: Vector3 = b["centre"]
		c.x += _drift.x * speed * dt
		c.z += _drift.y * speed * dt
		if c.x > hi.x: c.x = lo.x
		elif c.x < lo.x: c.x = hi.x
		if c.z > hi.y: c.z = lo.y
		elif c.z < lo.y: c.z = hi.y
		b["centre"] = c
	_place_fog()


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
	if _fog != null:
		_drift_fog(dt, wind)
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
