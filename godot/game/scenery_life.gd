## Ambient life over the island: a few flocks of birds wheeling high above, and butterflies
## fluttering over the flowers. Toon-shaded primitives, no collision, cheap to animate.
extends Node3D

const Toon := preload("res://game/toon.gd")

var _birds: Array = []  # {node, wings: [l, r], center, radius, height, speed, angle, phase}
var _flies: Array = []  # {node, wings, home, phase, speed}
var _time := 0.0


func setup(size_x: float, size_z: float, sea_y: float, butterflies: bool, flowers: Array, seed_value: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value * 31 + 7
	var mid := Vector3(size_x * 0.5, 0, size_z * 0.5)
	var span := maxf(size_x, size_z)
	for flock in 3:
		var center := mid + Vector3(rng.randf_range(-0.2, 0.2) * span, 0, rng.randf_range(-0.2, 0.2) * span)
		var radius := rng.randf_range(0.18, 0.32) * span
		var height := sea_y + rng.randf_range(38.0, 58.0)
		var speed := rng.randf_range(0.10, 0.18) * (1.0 if flock % 2 == 0 else -1.0)
		for i in rng.randi_range(4, 7):
			var b := _bird(rng)
			add_child(b["node"])
			b["center"] = center + Vector3(rng.randf_range(-6, 6), 0, rng.randf_range(-6, 6))
			b["radius"] = radius + rng.randf_range(-8.0, 8.0)
			b["height"] = height + rng.randf_range(-5.0, 5.0)
			b["speed"] = speed
			b["angle"] = float(i) * 0.12 + rng.randf() * 0.05
			b["phase"] = rng.randf() * TAU
			_birds.append(b)
	if butterflies and not flowers.is_empty():
		for i in mini(28, flowers.size() * 2):
			var f := _butterfly(rng)
			add_child(f["node"])
			f["home"] = flowers[rng.randi() % flowers.size()] + Vector3(0, 2.5, 0)
			f["phase"] = rng.randf() * 50.0
			f["speed"] = rng.randf_range(0.6, 1.1)
			_flies.append(f)
	_process(0.0)


func _process(dt: float) -> void:
	_time += dt
	for b: Dictionary in _birds:
		var a: float = b["angle"] + _time * float(b["speed"])
		var c: Vector3 = b["center"]
		var r: float = b["radius"]
		var n: Node3D = b["node"]
		var bob := sin(_time * 0.9 + float(b["phase"])) * 2.5
		n.position = c + Vector3(cos(a) * r, float(b["height"]) + bob, sin(a) * r)
		var dir := Vector3(-sin(a), 0, cos(a)) * signf(float(b["speed"]))
		n.look_at(n.position + dir, Vector3.UP)
		n.rotation.z = -0.35 * signf(float(b["speed"]))
		var flap := sin(_time * 7.0 + float(b["phase"]))
		var glide := 0.25 + 0.75 * clampf(sin(_time * 0.7 + float(b["phase"])) * 2.0, 0.0, 1.0)
		(b["wings"][0] as Node3D).rotation.z = 0.15 + flap * 0.7 * glide
		(b["wings"][1] as Node3D).rotation.z = -0.15 - flap * 0.7 * glide
	for f: Dictionary in _flies:
		var t: float = _time * float(f["speed"]) + float(f["phase"])
		var home: Vector3 = f["home"]
		var n: Node3D = f["node"]
		var p := home + Vector3(sin(t * 0.9) * 3.0 + sin(t * 2.1) * 1.0, sin(t * 1.7) * 0.8, cos(t * 0.7) * 3.0)
		var heading := p - n.position
		n.position = p
		if heading.length_squared() > 0.0001:
			n.rotation.y = atan2(heading.x, heading.z)
		var flap := absf(sin(_time * 14.0 + float(f["phase"])))
		(f["wings"][0] as Node3D).rotation.z = 0.2 + flap * 1.1
		(f["wings"][1] as Node3D).rotation.z = -0.2 - flap * 1.1


static func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.albedo_color = c
	m.roughness = 1.0
	return m


static func _box(size: Vector3, mat: Material, pos := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = mat
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


func _bird(rng: RandomNumberGenerator) -> Dictionary:
	var root := Node3D.new()
	var body_c := Color(["f4ead5", "ffffff", "e8e0f0"][rng.randi() % 3])
	var mat := _mat(body_c)
	var body := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.6
	s.height = 1.2
	s.radial_segments = 8
	s.rings = 4
	body.mesh = s
	body.scale = Vector3(0.9, 0.8, 1.8)
	body.material_override = mat
	root.add_child(body)
	root.add_child(_box(Vector3(0.3, 0.3, 0.5), _mat(Color("f2a03d")), Vector3(0, 0, -1.2)))
	var wings := []
	for side in [-1.0, 1.0]:
		var pivot := Node3D.new()
		pivot.position = Vector3(0.35 * side, 0.15, 0)
		pivot.add_child(_box(Vector3(2.2, 0.08, 0.9), mat, Vector3(1.1 * side, 0, 0)))
		root.add_child(pivot)
		wings.append(pivot)
	root.scale = Vector3.ONE * 0.75
	return {"node": root, "wings": wings}


func _butterfly(rng: RandomNumberGenerator) -> Dictionary:
	var root := Node3D.new()
	var c := Color(["ffd23f", "ff7aa8", "7ab8ff", "ffffff", "ff9a3d"][rng.randi() % 5])
	var mat := _mat(c)
	root.add_child(_box(Vector3(0.12, 0.12, 0.6), _mat(Color("2a2433"))))
	var wings := []
	for side in [-1.0, 1.0]:
		var pivot := Node3D.new()
		pivot.add_child(_box(Vector3(0.7, 0.04, 0.6), mat, Vector3(0.35 * side, 0, 0)))
		root.add_child(pivot)
		wings.append(pivot)
	root.scale = Vector3.ONE * 1.2
	return {"node": root, "wings": wings}
