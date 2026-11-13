class_name ShotModels
extends RefCounted
## Little toy models for every projectile in flight, built from primitives so they stay reviewable
## as text. Each model is a Node3D with a "Body" child (the part that spins) and, for most, a
## smoke or spark trail that stays behind in the world. Unknown weapons get a plain grey ball.

const BROWN := Color("8b5a2b")
const DARK_BROWN := Color("5b3a1a")
const BLUE := Color("4aa3df")
const WHITE := Color("f7f1e4")
const YELLOW := Color("ffcf3f")
const BLACK := Color("2b2118")
const RED := Color("e0463a")
const GREEN := Color("5cc46a")
const GREY := Color("8d8a86")

static var _mats: Dictionary = {}


## Which weapon ids have their own model (the rest use the grey ball).
const KNOWN: Array[String] = [
	"acorn-mortar", "fizz-grenade", "pinecone-popper", "pinecone-seed", "beehive-bomb", "hopper-ball",
	"firecracker-bundle", "boulder-of-doom", "jelly-mine",
]


static func make(weapon: String) -> Node3D:
	var root := Node3D.new()
	root.name = "Shot"
	var body := Node3D.new()
	body.name = "Body"
	root.add_child(body)
	var trail := {"color": Color(1, 1, 1, 0.55), "size": 0.45, "rate": 26, "life": 0.7, "spark": false}
	match weapon:
		"acorn-mortar":
			_acorn(body)
		"fizz-grenade":
			_can(body)
			trail = {"color": Color(0.75, 0.9, 1.0, 0.5), "size": 0.35, "rate": 30, "life": 0.6, "spark": false}
		"pinecone-popper":
			_pinecone(body, 1.0)
			trail = {"color": Color(0.9, 0.85, 0.75, 0.5), "size": 0.4, "rate": 24, "life": 0.7, "spark": false}
		"pinecone-seed":
			_pinecone(body, 0.5)
			trail = {"color": Color(0.9, 0.85, 0.75, 0.45), "size": 0.22, "rate": 20, "life": 0.45, "spark": false}
		"beehive-bomb":
			_bee_bomb(body)
			trail = {"color": Color(1.0, 0.9, 0.4, 0.5), "size": 0.3, "rate": 24, "life": 0.5, "spark": false}
		"hopper-ball":
			_ball(body, GREEN, 1.0, true)
			trail = {"color": Color(0.7, 1.0, 0.75, 0.4), "size": 0.3, "rate": 18, "life": 0.4, "spark": false}
		"firecracker-bundle":
			_firecrackers(body)
			trail = {"color": Color(1.0, 0.8, 0.25, 1.0), "size": 0.22, "rate": 60, "life": 0.35, "spark": true}
		"jelly-mine":
			_mine(body)
			trail = {"color": Color(1, 1, 1, 0.0), "size": 0.1, "rate": 1, "life": 0.1, "spark": false}
		"boulder-of-doom":
			_boulder(body)
			trail = {"color": Color(0.7, 0.62, 0.5, 0.6), "size": 0.9, "rate": 20, "life": 1.0, "spark": false}
		_:
			_ball(body, GREY, 0.9, false)
	root.add_child(_trail(trail))
	root.set_meta("weapon", weapon)
	return root


static func _mat(color: Color, rough := 0.7) -> StandardMaterial3D:
	var key := "%s/%s" % [color.to_html(), rough]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	_mats[key] = m
	return m


static func _mi(mesh: Mesh, color: Color, pos := Vector3.ZERO, rough := 0.7) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = _mat(color, rough)
	m.position = pos
	return m


static func _sphere(radius: float, squash := 1.0) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0 * squash
	s.radial_segments = 14
	s.rings = 8
	return s


static func _cyl(top: float, bottom: float, height: float) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = height
	c.radial_segments = 12
	return c


static func _ball(body: Node3D, color: Color, radius: float, striped: bool) -> void:
	body.add_child(_mi(_sphere(radius), color))
	if striped:
		var band := TorusMesh.new()
		band.inner_radius = radius * 0.96
		band.outer_radius = radius * 1.04
		var ring := _mi(band, WHITE)
		ring.rotation.x = deg_to_rad(90.0)
		body.add_child(ring)


static func _acorn(body: Node3D) -> void:
	body.add_child(_mi(_sphere(0.85, 1.15), BROWN, Vector3(0, -0.1, 0), 0.6))
	var cap := _mi(_sphere(0.9, 0.7), DARK_BROWN, Vector3(0, 0.35, 0), 0.9)
	body.add_child(cap)
	body.add_child(_mi(_cyl(0.06, 0.1, 0.4), DARK_BROWN, Vector3(0, 1.05, 0)))


static func _can(body: Node3D) -> void:
	body.add_child(_mi(_cyl(0.7, 0.7, 1.5), BLUE, Vector3.ZERO, 0.4))
	body.add_child(_mi(_cyl(0.72, 0.72, 0.3), WHITE, Vector3(0, 0.45, 0), 0.4))
	body.add_child(_mi(_cyl(0.45, 0.6, 0.2), GREY, Vector3(0, 0.85, 0), 0.3))
	var pin := _mi(_cyl(0.05, 0.05, 0.5), RED, Vector3(0.0, 1.1, 0.0))
	pin.rotation.z = deg_to_rad(40.0)
	body.add_child(pin)


## A pinecone: an egg of overlapping scale rows, bigger or smaller by `size`.
static func _pinecone(body: Node3D, size: float) -> void:
	body.add_child(_mi(_sphere(0.7 * size, 1.5), BROWN, Vector3.ZERO, 0.9))
	for row in range(3):
		var y := (float(row) - 1.0) * 0.55 * size
		var r := (0.72 - absf(float(row) - 1.0) * 0.18) * size
		for k in range(6):
			var a := float(k) / 6.0 * TAU + float(row) * 0.5
			var scale_piece := _mi(_sphere(0.28 * size, 0.55), DARK_BROWN, Vector3(cos(a) * r, y, sin(a) * r), 0.95)
			scale_piece.basis = Basis.looking_at(Vector3(cos(a), 0.0, sin(a)), Vector3.UP)
			body.add_child(scale_piece)


static func _bee_bomb(body: Node3D) -> void:
	body.add_child(_mi(_sphere(0.8, 1.2), YELLOW, Vector3.ZERO, 0.5))
	for dy in [-0.28, 0.28]:
		var band := TorusMesh.new()
		band.inner_radius = 0.7
		band.outer_radius = 0.85
		var ring := _mi(band, BLACK, Vector3(0, dy, 0))
		ring.scale = Vector3(1, 1, 1)
		body.add_child(ring)
	for sx in [-1.0, 1.0]:
		var wing := _mi(_sphere(0.5, 0.15), Color(0.85, 0.95, 1.0, 1.0), Vector3(sx * 0.7, 0.75, 0), 0.2)
		wing.rotation.z = deg_to_rad(sx * 25.0)
		body.add_child(wing)


static func _firecrackers(body: Node3D) -> void:
	for i in range(3):
		var a := float(i) / 3.0 * TAU
		var stick := _mi(_cyl(0.22, 0.22, 1.4), RED, Vector3(cos(a) * 0.28, 0, sin(a) * 0.28), 0.6)
		stick.rotation.z = deg_to_rad(8.0 * cos(a))
		body.add_child(stick)
	body.add_child(_mi(_cyl(0.62, 0.62, 0.22), YELLOW, Vector3(0, 0.1, 0), 0.5))
	body.add_child(_mi(_cyl(0.03, 0.03, 0.7), BLACK, Vector3(0, 1.0, 0)))


## A wobbly pink jelly dome sitting on the ground.
static func _mine(body: Node3D) -> void:
	var dome := SphereMesh.new()
	dome.radius = 1.3
	dome.height = 1.3
	dome.is_hemisphere = true
	dome.radial_segments = 16
	dome.rings = 8
	var m := _mi(dome, Color("ff5fa2"), Vector3.ZERO, 0.15)
	var mat := (m.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
	mat.emission_enabled = true
	mat.emission = Color("ff2d7a")
	mat.emission_energy_multiplier = 0.4
	m.material_override = mat
	m.name = "Jelly"
	body.add_child(m)


static func _boulder(body: Node3D) -> void:
	body.add_child(_mi(_sphere(2.6), GREY, Vector3.ZERO, 1.0))
	for i in range(7):
		var a := float(i) * 2.4
		var bump := _mi(_sphere(0.9), GREY.darkened(0.12 * float(i % 3)), Vector3(cos(a) * 2.2, sin(a * 1.7) * 1.8, sin(a) * 2.2), 1.0)
		body.add_child(bump)


## A smoke puff (or spark) trail left behind in the world as the shot flies.
static func _trail(cfg: Dictionary) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.name = "Trail"
	p.local_coords = false
	p.amount = 24
	p.lifetime = float(cfg["life"])
	p.one_shot = false
	p.emitting = true
	p.explosiveness = 0.0
	p.randomness = 0.3
	p.direction = Vector3.UP
	p.spread = 180.0 if bool(cfg["spark"]) else 25.0
	p.initial_velocity_min = 2.0 if bool(cfg["spark"]) else 0.3
	p.initial_velocity_max = 7.0 if bool(cfg["spark"]) else 1.2
	p.gravity = Vector3(0, -30 if bool(cfg["spark"]) else 1.5, 0)
	var size := float(cfg["size"])
	var ball := SphereMesh.new()
	ball.radius = size
	ball.height = size * 2.0
	ball.radial_segments = 8
	ball.rings = 4
	p.mesh = ball
	var fade := Gradient.new()
	var c: Color = cfg["color"]
	fade.set_color(0, c)
	fade.set_color(1, Color(c.r, c.g, c.b, 0.0))
	p.color_ramp = fade
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.6))
	curve.add_point(Vector2(1.0, 0.0 if bool(cfg["spark"]) else 1.6))
	p.scale_amount_curve = curve
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if bool(cfg["spark"]):
		m.emission_enabled = true
		m.emission = Color("ffb52e")
		m.emission_energy_multiplier = 2.5
	p.material_override = m
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p
