class_name MatchEnvironment
extends Node3D
## Sunset sky, sun with shadows, glow, a fizzy soda sea out to the horizon, clouds and four poles
## with paper wind streamers (port of client/src/game3d/environment.ts, in Godot's renderer).

const POLE_COLORS: Array[Color] = [Color("e85d4a"), Color("f2b544"), Color("5cc49b"), Color("4aa3df")]
const SEG_COUNT := 7
const SEG_LEN := 2.0

var sun: DirectionalLight3D
var sea: MeshInstance3D
var _world_env: WorldEnvironment
var _streamers: Array[Dictionary] = []
var _time: float = 0.0
var _size_x: float = 256.0
var _size_z: float = 256.0
var _look: Dictionary = MapLook.for_theme(MapLook.DEFAULT)
## Lightning: how bright the current flash still is (0..1), and the light levels it adds to.
var _flash := 0.0
var _base_ambient := 1.0
var _base_sun := 1.5
var moon: Node3D = null


## Build everything for a map of the given size. `ground_y` is a Callable(x, z) -> float.
func setup(size_x: float, size_z: float, sea_y: float, ground_y: Callable, look: Dictionary = {}) -> void:
	if not look.is_empty():
		_look = look
	# A fresh match.start (a reconnect) rebuilds everything.
	for child in get_children():
		child.queue_free()
	_streamers.clear()
	_size_x = size_x
	_size_z = size_z
	_build_sky()
	_build_sun()
	_build_sea(sea_y)
	_build_clouds()
	if bool(_look.get("night", false)):
		_build_night_sky()
	_build_streamers(ground_y, sea_y)


## Distance from the camera where the haze starts: the map's longest side, so the whole map stays clear.
static func fog_begin(size_x: float, size_z: float) -> float:
	return maxf(size_x, size_z)


func set_sea_y(y: float) -> void:
	if sea != null:
		sea.position.y = y


func _build_sky() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = MapLook.color(_look, "sky_top")
	sky_mat.sky_horizon_color = MapLook.color(_look, "sky_horizon")
	sky_mat.ground_horizon_color = MapLook.color(_look, "sky_horizon")
	sky_mat.ground_bottom_color = MapLook.color(_look, "sky_bottom")
	sky_mat.sun_angle_max = 9.0
	sky_mat.sky_curve = 0.18
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = float(_look.get("ambient", 1.0))
	_base_ambient = env.ambient_light_energy
	# Linear keeps the painted colours as bright as they are picked (filmic greys them down).
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	# Glow only for things brighter than white (explosions, the sun), never the whole picture.
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 1.2
	# A light warm haze far away. It must not paint over the sky or the near island: depth fog that
	# starts past the far edge of the map, so even the overview camera sees the island clearly.
	# (Exponential fog from the camera washed the whole island out in distant shots.)
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = MapLook.color(_look, "fog")
	# Fog weather pulls the haze in close; rain brings it a little nearer too.
	env.fog_density = float(_look.get("fog_density", 0.6))
	env.fog_depth_begin = float(_look.get("fog_near", fog_begin(_size_x, _size_z)))
	env.fog_depth_end = float(_look.get("fog_far", env.fog_depth_begin + 1200.0))
	env.fog_depth_curve = 1.0
	env.fog_sky_affect = float(_look.get("fog_sky", 0.0))
	env.adjustment_enabled = true
	env.adjustment_saturation = MapLook.saturation(_look)
	env.adjustment_contrast = 1.08
	_world_env = WorldEnvironment.new()
	_world_env.environment = env
	add_child(_world_env)


func _build_sun() -> void:
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = MapLook.color(_look, "sun")
	sun.light_energy = float(_look.get("sun_energy", 1.5))
	_base_sun = sun.light_energy
	sun.light_specular = 0.25  # keeps the sun's mirror image on the sea from whiting out the view
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = maxf(_size_x, _size_z) * 1.4
	sun.shadow_bias = 0.05
	sun.shadow_normal_bias = 1.0
	# Low warm light from the south-west, so craters and hats throw long shadows.
	sun.rotation_degrees = Vector3(float(_look.get("sun_pitch", -38.0)), float(_look.get("sun_yaw", 215.0)), 0.0)
	add_child(sun)


func _build_sea(sea_y: float) -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(4000.0, 4000.0)
	plane.subdivide_width = 160
	plane.subdivide_depth = 160
	sea = MeshInstance3D.new()
	sea.name = "Sea"
	sea.mesh = plane
	sea.material_override = preload("res://terrain/sea_material.gd").make(
		MapLook.color(_look, "sea_shallow"), MapLook.color(_look, "sea_deep"), MapLook.color(_look, "sea_horizon")
	)
	# The sea fades to the horizon colour only beyond the map, not across the water next to it.
	(sea.material_override as ShaderMaterial).set_shader_parameter("horizon_start", fog_begin(_size_x, _size_z))
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(_size_x * 0.5, sea_y, _size_z * 0.5)
	add_child(sea)


func _build_clouds() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1234  # looks only: clouds are the same every run
	var mat := StandardMaterial3D.new()
	mat.albedo_color = MapLook.color(_look, "cloud")
	mat.roughness = 1.0
	mat.emission_enabled = true
	mat.emission = Color("ffd2a8") if not _look.has("weather") else MapLook.color(_look, "cloud")
	mat.emission_energy_multiplier = float(_look.get("cloud_glow", 0.25))
	for i in range(int(_look.get("cloud_count", 14))):
		var cloud := Node3D.new()
		cloud.name = "Cloud%d" % i
		var angle := rng.randf() * TAU
		var r := rng.randf_range(260.0, 700.0)
		cloud.position = Vector3(
			_size_x * 0.5 + cos(angle) * r, rng.randf_range(110.0, 220.0), _size_z * 0.5 + sin(angle) * r
		)
		for j in range(5):
			var puff := MeshInstance3D.new()
			var s := SphereMesh.new()
			s.radius = rng.randf_range(16.0, 30.0)
			s.height = s.radius * 1.6
			puff.mesh = s
			puff.material_override = mat
			puff.position = Vector3(float(j - 2) * 22.0, rng.randf_range(-4.0, 6.0), rng.randf_range(-8.0, 8.0))
			puff.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			cloud.add_child(puff)
		add_child(cloud)


## Night: a big pale moon low over the sea (where the moonlight comes from) and a field of stars.
func _build_night_sky() -> void:
	var dir := -sun.global_transform.basis.z  # the way the light travels
	var centre := Vector3(_size_x * 0.5, 0.0, _size_z * 0.5)
	moon = Node3D.new()
	moon.name = "Moon"
	var ball := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 38.0
	sphere.height = 76.0
	ball.mesh = sphere
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color("eef2ff")
	mat.emission_enabled = true
	mat.emission = Color("dfe8ff")
	mat.emission_energy_multiplier = 1.6
	mat.disable_fog = true
	ball.material_override = mat
	ball.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	moon.add_child(ball)
	# Darker "seas" on its face, so it reads as a moon and not a lamp.
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	var spot_mat := mat.duplicate() as StandardMaterial3D
	spot_mat.albedo_color = Color("c4cde6")
	spot_mat.emission = Color("b8c2e0")
	for i in 5:
		var spot := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = rng.randf_range(6.0, 12.0)
		s.height = s.radius * 0.6
		spot.mesh = s
		spot.material_override = spot_mat
		var a := rng.randf() * TAU
		spot.position = Vector3(cos(a), sin(a), 0) * rng.randf_range(8.0, 22.0) + Vector3(0, 0, 33.0)
		ball.add_child(spot)
	moon.position = centre - dir * 1400.0
	moon.look_at_from_position(moon.position, centre, Vector3.UP)
	moon.rotate_object_local(Vector3.UP, PI)
	add_child(moon)
	# Stars: one MultiMesh of tiny unshaded quads on a dome, brighter near the top.
	var quad := QuadMesh.new()
	quad.size = Vector2(3.0, 3.0)
	var smat := StandardMaterial3D.new()
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	smat.vertex_color_use_as_albedo = true
	smat.disable_fog = true
	quad.material = smat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = quad
	mm.instance_count = 700
	for i in mm.instance_count:
		var az := rng.randf() * TAU
		var el := asin(rng.randf_range(0.08, 1.0))
		var p := Vector3(cos(az) * cos(el), sin(el), sin(az) * cos(el)) * 1700.0
		var size := rng.randf_range(0.5, 1.6)
		mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ONE * size), centre + p))
		var b := rng.randf_range(0.55, 1.0) * (0.6 + 0.4 * sin(el))
		mm.set_instance_color(i, Color(b, b, minf(1.0, b * 1.1)))
	var stars := MultiMeshInstance3D.new()
	stars.name = "Stars"
	stars.multimesh = mm
	stars.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(stars)


## A lightning flash: the whole scene lights up for a moment, then fades (see update).
func flash(strength := 1.0) -> void:
	_flash = maxf(_flash, clampf(strength, 0.0, 1.0))


## Four poles near the corners with streamers that point and flutter with the wind.
func _build_streamers(ground_y: Callable, sea_y: float) -> void:
	var spots := [
		Vector2(30, 30), Vector2(_size_x - 30, 30), Vector2(30, _size_z - 30), Vector2(_size_x - 30, _size_z - 30)
	]
	for i in range(spots.size()):
		var p: Vector2 = spots[i]
		var gy := maxf(sea_y, float(ground_y.call(p.x, p.y)))
		var pole := Node3D.new()
		pole.name = "Pole%d" % i
		pole.position = Vector3(p.x, gy, p.y)
		var stick := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.25
		cyl.bottom_radius = 0.3
		cyl.height = 22.0
		stick.mesh = cyl
		stick.position.y = 11.0
		var stick_mat := StandardMaterial3D.new()
		stick_mat.albedo_color = Color("f7f0e0")
		stick.material_override = stick_mat
		pole.add_child(stick)
		var ribbon := Node3D.new()
		ribbon.position.y = 20.5
		pole.add_child(ribbon)
		var mat := StandardMaterial3D.new()
		mat.albedo_color = POLE_COLORS[i]
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		var segs: Array[Node3D] = []
		var parent: Node3D = ribbon
		for s in range(SEG_COUNT):
			var seg := Node3D.new()
			seg.position = Vector3(0, 0, 0 if s == 0 else SEG_LEN)
			var box := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(0.1, 2.6, SEG_LEN)
			box.mesh = bm
			box.position = Vector3(0, 0, SEG_LEN * 0.5)
			box.material_override = mat
			seg.add_child(box)
			parent.add_child(seg)
			segs.append(seg)
			parent = seg
		add_child(pole)
		_streamers.append({"ribbon": ribbon, "segs": segs, "phase": float(i) * 1.7})


## Flutter the streamers. `wind` is the horizontal wind vector (x, z), each axis -100..100.
func update(dt: float, wind: Vector2) -> void:
	_time += dt
	if _flash > 0.0 and _world_env != null:
		_flash = maxf(0.0, _flash - dt * 2.2)
		_world_env.environment.ambient_light_energy = _base_ambient + _flash * 3.0
		if sun != null:
			sun.light_energy = _base_sun + _flash * 2.5
	var w := HudModel.wind_streamer(wind)
	var strength: float = w["strength"]
	var heading: float = w["heading_deg"]
	for s in _streamers:
		var ribbon: Node3D = s["ribbon"]
		ribbon.rotation.y = deg_to_rad(heading)
		var segs: Array = s["segs"]
		for i in range(segs.size()):
			var seg: Node3D = segs[i]
			var wave := _time * (3.0 + strength * 9.0) - float(i) * 0.8 + float(s["phase"])
			# Calm air lets the paper hang; strong wind lifts it flat and makes it flutter.
			seg.rotation.x = (1.0 - strength) * 0.4 + sin(wave) * 0.12 * strength
			seg.rotation.y = cos(wave) * 0.3 * strength
