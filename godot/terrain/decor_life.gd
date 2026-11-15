## Ambient life on the decor layer (child of DecorView): moored boats bob on the swell, flags and
## weathervanes swing in the breeze, chimney pots smoke, and the lighthouse lens sweeps a warm
## beam over the village. Client-only cosmetics; anything that broke off stops moving, a broken
## chimney stops smoking, and a broken lens goes dark.
extends Node3D

## Kinds whose instances move every frame, and how.
const MOVERS := {
	"moored-boat": "bob", "lifeboat": "bob", "flagpole": "flag", "bow-flag": "flag",
	"stern-flag": "flag", "weathervane": "vane",
}
## Where the two flues of a "chimney-pot" end, in the anchor's frame.
const FLUES := [Vector3(-0.6, 2.0, 0), Vector3(0.6, 2.2, 0)]
## Lighthouse beam: length of each half, turns per second, how bright the shaft is.
const BEAM_LENGTH := 120.0
const BEAM_SPEED := 0.35
const BEAM_STRENGTH := 0.32

const BEAM_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
uniform vec3 tint : source_color = vec3(1.0, 0.86, 0.55);
uniform float strength = 0.3;
void fragment() {
	// Bright at the lens, fading to nothing at the far end; soft at the shaft's edges.
	float along = pow(1.0 - UV.y, 1.6);
	float edge = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 1.4);
	ALBEDO = tint;
	ALPHA = clamp(along * edge * strength, 0.0, 1.0);
}
"""

## How much brighter the beam is than by day (the match sets it from the time of day before the
## map loads: about 3 at night, so the sweep is the brightest thing in the village).
static var beam_boost := 1.0

var _view: Node3D = null
var _movers := []  # [kind, instance, mode, phase]
var _flues := []  # [kind, instance, world point]
var _lens := []  # [kind, instance]
var _smoke: CPUParticles3D = null
var _beam: Node3D = null
var _time := 0.0


## Pick up the moving, smoking and shining pieces from a built DecorView.
func setup(view: Node3D) -> void:
	_view = view
	var kinds: Dictionary = view.call("kind_table")
	for kind in kinds:
		var xf: Array = kinds[kind]["xf"]
		if MOVERS.has(kind):
			for i in xf.size():
				_movers.append([kind, i, MOVERS[kind], float(i) * 1.7 + float(kind.length())])
		elif kind == "chimney-pot":
			for i in xf.size():
				var t: Transform3D = xf[i]
				for f in FLUES:
					_flues.append([kind, i, t * f])
		elif kind == "lens" and not xf.is_empty():
			_lens.append([kind, 0])
			_add_beam((xf[0] as Transform3D).origin + Vector3(0, 1.7, 0))
	_add_smoke()


## A patch broke some detail: stop smoke from broken chimneys, darken a broken lens.
func refresh() -> void:
	if _smoke != null:
		var pts := PackedVector3Array()
		for f in _flues:
			if not _view.call("is_broken", f[0], f[1]):
				pts.append(f[2])
		if pts.is_empty():
			_smoke.emitting = false
		else:
			_smoke.emission_points = pts
	if _beam != null and not _lens.is_empty() and _view.call("is_broken", _lens[0][0], _lens[0][1]):
		_beam.queue_free()
		_beam = null


## How many chimneys are smoking, and whether the beam turns (for tests and the playtest report).
func smoking() -> int:
	return 0 if _smoke == null or not _smoke.emitting else _smoke.emission_points.size()


func beam_on() -> bool:
	return _beam != null


func _process(delta: float) -> void:
	if _view == null:
		return
	_time += delta
	var kinds: Dictionary = _view.call("kind_table")
	for m in _movers:
		var kind: String = m[0]
		var i: int = m[1]
		if _view.call("is_broken", kind, i):
			continue
		var k: Dictionary = kinds[kind]
		var base: Transform3D = (k["xf"] as Array)[i]
		var ph: float = m[3]
		var xf := base
		match m[2]:
			"bob":
				xf.origin.y += sin(_time * 1.1 + ph) * 0.22
				xf.basis = Basis(base.basis.z.normalized(), sin(_time * 0.9 + ph) * 0.06) * base.basis
			"flag":
				xf.basis = Basis(Vector3.UP, sin(_time * 2.2 + ph) * 0.3 + sin(_time * 5.1 + ph) * 0.06) * base.basis
			"vane":
				xf.basis = Basis(Vector3.UP, sin(_time * 0.25 + ph) * 0.9) * base.basis
		(k["mm"] as MultiMesh).set_instance_transform(i, xf)
	if _beam != null:
		_beam.rotation.y = _time * BEAM_SPEED * TAU


func _add_smoke() -> void:
	if _flues.is_empty():
		return
	var p := CPUParticles3D.new()
	p.name = "ChimneySmoke"
	var pts := PackedVector3Array()
	for f in _flues:
		pts.append(f[2])
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_POINTS
	p.emission_points = pts
	p.amount = clampi(pts.size() * 5, 16, 700)
	p.lifetime = 5.0
	p.preprocess = 5.0
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 12.0
	p.initial_velocity_min = 1.2
	p.initial_velocity_max = 2.2
	p.gravity = Vector3(0.7, 0.25, 0.25)  # a sea breeze bends the plumes inland
	p.damping_min = 0.3
	p.damping_max = 0.6
	p.scale_amount_min = 0.7
	p.scale_amount_max = 1.1
	var grow := Curve.new()
	grow.add_point(Vector2(0, 0.35))
	grow.add_point(Vector2(1, 2.4))
	p.scale_amount_curve = grow
	var fade := Gradient.new()
	fade.set_color(0, Color(0.93, 0.92, 0.9, 0.55))
	fade.set_color(1, Color(0.8, 0.8, 0.85, 0.0))
	p.color_ramp = fade
	var puff := SphereMesh.new()
	puff.radius = 0.6
	puff.height = 1.1
	puff.radial_segments = 6
	puff.rings = 3
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	puff.material = mat
	p.mesh = puff
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	_smoke = p


## Re-light an existing beam (the time of day changed).
func set_beam_boost(k: float) -> void:
	beam_boost = k
	if _beam == null:
		return
	for c in _beam.get_children():
		if c is SpotLight3D:
			(c as SpotLight3D).light_energy = 6.0 * k
			(c as SpotLight3D).spot_range = 160.0 * minf(1.6, sqrt(k))
		elif c is MeshInstance3D:
			var m := ((c as MeshInstance3D).mesh as PrimitiveMesh).material as ShaderMaterial
			if m != null:
				m.set_shader_parameter("strength", minf(0.95, BEAM_STRENGTH * k))


func _add_beam(at: Vector3) -> void:
	_beam = Node3D.new()
	_beam.name = "LighthouseBeam"
	_beam.position = at
	add_child(_beam)
	var sh := Shader.new()
	sh.code = BEAM_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = sh
	mat.set_shader_parameter("strength", minf(0.95, BEAM_STRENGTH * beam_boost))
	for side in [1.0, -1.0]:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.9
		cone.bottom_radius = 9.0
		cone.height = BEAM_LENGTH
		cone.radial_segments = 20
		cone.rings = 1
		cone.cap_top = false
		cone.cap_bottom = false
		cone.material = mat
		var shaft := MeshInstance3D.new()
		shaft.mesh = cone
		shaft.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# The cylinder's narrow top end sits at the lens; the shaft points out along +-x.
		shaft.transform = Transform3D(Basis(Vector3.BACK, PI * 0.5 * side), Vector3(side * BEAM_LENGTH * 0.5, 0, 0))
		_beam.add_child(shaft)
		var spot := SpotLight3D.new()
		spot.light_color = Color(1.0, 0.88, 0.6)
		spot.light_energy = 6.0 * beam_boost
		spot.spot_range = 160.0 * minf(1.6, sqrt(beam_boost))
		spot.spot_angle = 7.0
		spot.shadow_enabled = false
		# Spot lights shine down their -z; turn that to +-x and tip it a little toward the sea.
		spot.transform = Transform3D(Basis(Vector3.UP, -PI * 0.5 * side) * Basis(Vector3.RIGHT, -0.06), Vector3.ZERO)
		_beam.add_child(spot)
	var glow := OmniLight3D.new()
	glow.light_color = Color(1.0, 0.85, 0.55)
	glow.light_energy = 2.5
	glow.omni_range = 22.0
	_beam.add_child(glow)
