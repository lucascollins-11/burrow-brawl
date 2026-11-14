class_name ZoneViews
extends Node3D
## Puddles on the ground: fire (a flickering orange disc with flames and smoke) and glue (a
## glossy amber disc that bubbles). Synced from the snapshot's `zones` every frame; a missing id
## has dried up and its node is removed.

var _nodes: Dictionary = {}  # id -> {root, kind, disc}
var _t := 0.0


func sync(zones: Array, dt: float) -> void:
	_t += dt
	var seen := {}
	for z: Dictionary in zones:
		var id := int(z["id"])
		seen[id] = true
		var entry: Dictionary = _nodes.get(id, {})
		if entry.is_empty():
			entry = _make(z)
			_nodes[id] = entry
			add_child(entry["root"])
		var root: Node3D = entry["root"]
		root.position = z["pos"]
		var mat := (entry["disc"] as MeshInstance3D).material_override as StandardMaterial3D
		if entry["kind"] == "fire":
			mat.emission_energy_multiplier = 1.4 + 0.5 * sin(_t * 11.0 + float(id))
		else:
			mat.emission_energy_multiplier = 0.15
	for id in _nodes.keys():
		if not seen.has(id):
			_drop(id)


func kinds() -> Dictionary:
	var out := {}
	for id in _nodes:
		out[id] = _nodes[id]["kind"]
	return out


func clear() -> void:
	for id in _nodes.keys():
		_drop(id)


func _drop(id: int) -> void:
	(_nodes[id]["root"] as Node).queue_free()
	_nodes.erase(id)


func _make(z: Dictionary) -> Dictionary:
	var kind := str(z.get("kind", "fire"))
	var r := float(z.get("r", 3.0))
	var root := Node3D.new()
	root.name = "Zone%d" % int(z["id"])
	var disc := MeshInstance3D.new()
	disc.name = "Disc"
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = 0.25
	cm.radial_segments = 24
	disc.mesh = cm
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.emission_enabled = true
	if kind == "fire":
		m.albedo_color = Color(1.0, 0.45, 0.1, 0.8)
		m.emission = Color(1.0, 0.4, 0.05)
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		m.albedo_color = Color(0.95, 0.78, 0.25, 0.75)
		m.emission = Color(0.9, 0.7, 0.2)
		m.roughness = 0.05
		m.metallic = 0.2
	disc.material_override = m
	disc.position = Vector3(0, 0.2, 0)
	disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(disc)
	if kind == "fire":
		root.add_child(_flames(r))
		root.add_child(_smoke(r))
	else:
		root.add_child(_bubbles(r))
	return {"root": root, "kind": kind, "disc": disc}


## A particle emitter spread over the disc. `up` is the rise speed, `color` fades to nothing.
static func _emitter(r: float, amount: int, life: float, up: float, color: Color, size: float, glow: bool) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.emitting = true
	p.local_coords = false
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = maxf(0.5, r * 0.8)
	p.direction = Vector3.UP
	p.spread = 12.0
	p.initial_velocity_min = up * 0.7
	p.initial_velocity_max = up * 1.3
	p.gravity = Vector3.ZERO
	var ball := SphereMesh.new()
	ball.radius = size
	ball.height = size * 2.0
	ball.radial_segments = 6
	ball.rings = 3
	p.mesh = ball
	var fade := Gradient.new()
	fade.set_color(0, color)
	fade.set_color(1, Color(color.r, color.g, color.b, 0.0))
	p.color_ramp = fade
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 1.0))
	curve.add_point(Vector2(1.0, 0.2 if glow else 1.6))
	p.scale_amount_curve = curve
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	p.material_override = m
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p


static func _flames(r: float) -> CPUParticles3D:
	var p := _emitter(r, int(10.0 + r * 5.0), 0.7, 5.0, Color(1.0, 0.6, 0.15, 0.9), 0.7, true)
	p.name = "Flames"
	p.position = Vector3(0, 0.4, 0)
	return p


static func _smoke(r: float) -> CPUParticles3D:
	var p := _emitter(r, 12, 1.8, 3.0, Color(0.25, 0.22, 0.2, 0.5), 0.9, false)
	p.name = "Smoke"
	p.position = Vector3(0, 2.0, 0)
	return p


static func _bubbles(r: float) -> CPUParticles3D:
	var p := _emitter(r, int(6.0 + r * 2.0), 1.4, 1.2, Color(1.0, 0.92, 0.55, 0.8), 0.3, true)
	p.name = "Bubbles"
	p.position = Vector3(0, 0.3, 0)
	return p
