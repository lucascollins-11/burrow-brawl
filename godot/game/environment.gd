class_name MatchEnvironment
extends Node3D
## Sunset sky, sun with shadows, glow, a fizzy pink soda sea out to the horizon, clouds and four poles
## with paper wind streamers (port of client/src/game3d/environment.ts, in Godot's renderer).

const SEA_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;
uniform vec4 tint : source_color = vec4(1.0, 0.55, 0.72, 0.86);
void vertex() {
	VERTEX.y += sin(VERTEX.x * 0.05 + TIME * 1.1) * 0.7 + cos(VERTEX.z * 0.06 + TIME * 0.9) * 0.6;
}
void fragment() {
	ALBEDO = tint.rgb;
	ALPHA = tint.a;
	ROUGHNESS = 0.2;
	METALLIC = 0.1;
	SPECULAR = 0.8;
}
"""
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


## Build everything for a map of the given size. `ground_y` is a Callable(x, z) -> float.
func setup(size_x: float, size_z: float, sea_y: float, ground_y: Callable) -> void:
	_size_x = size_x
	_size_z = size_z
	_build_sky()
	_build_sun()
	_build_sea(sea_y)
	_build_clouds()
	_build_streamers(ground_y, sea_y)


func set_sea_y(y: float) -> void:
	if sea != null:
		sea.position.y = y


func _build_sky() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("4f8fd8")
	sky_mat.sky_horizon_color = Color("ffb27a")
	sky_mat.ground_horizon_color = Color("ffb27a")
	sky_mat.ground_bottom_color = Color("c46a5a")
	sky_mat.sun_angle_max = 25.0
	sky_mat.sky_curve = 0.18
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.1
	env.fog_enabled = true
	env.fog_light_color = Color("ffc79a")
	env.fog_density = 0.0008
	_world_env = WorldEnvironment.new()
	_world_env.environment = env
	add_child(_world_env)


func _build_sun() -> void:
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = Color("ffd9a8")
	sun.light_energy = 1.7
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = maxf(_size_x, _size_z) * 1.4
	sun.shadow_bias = 0.05
	sun.shadow_normal_bias = 1.0
	# Low warm light from the south-west, so craters and hats throw long shadows.
	sun.rotation_degrees = Vector3(-38.0, 215.0, 0.0)
	add_child(sun)


func _build_sea(sea_y: float) -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(4000.0, 4000.0)
	plane.subdivide_width = 160
	plane.subdivide_depth = 160
	var shader := Shader.new()
	shader.code = SEA_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = shader
	sea = MeshInstance3D.new()
	sea.name = "Sea"
	sea.mesh = plane
	sea.material_override = mat
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(_size_x * 0.5, sea_y, _size_z * 0.5)
	add_child(sea)


func _build_clouds() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1234  # looks only: clouds are the same every run
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("fff3e6")
	mat.roughness = 1.0
	mat.emission_enabled = true
	mat.emission = Color("ffd2a8")
	mat.emission_energy_multiplier = 0.25
	for i in range(14):
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
