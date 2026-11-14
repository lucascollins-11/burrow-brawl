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
const BRASS := Color("e8b84a")

static var _mats: Dictionary = {}


## Which weapon ids have their own model (the rest use the grey ball).
const KNOWN: Array[String] = [
	"acorn-mortar", "fizz-grenade", "pinecone-popper", "pinecone-seed", "beehive-bomb", "hopper-ball",
	"firecracker-bundle", "boulder-of-doom", "jelly-mine", "wind-up-robot", "marble-roller", "rc-racer",
	"kite-bomber", "mousetrap-snapper", "paper-lantern", "giant-block", "meteor-marble", "pinata", "candy-bomb",
]
## Shots that travel along their own heading: drawn facing it, and animated by `animate`.
## Placed mines: dropped on the ground, never tumbled.
const MINES: Array[String] = ["jelly-mine", "mousetrap-snapper"]
const STEERED: Array[String] = ["wind-up-robot", "marble-roller", "rc-racer", "kite-bomber"]


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
		"mousetrap-snapper":
			_trap(body)
			trail = {"color": Color(1, 1, 1, 0.0), "size": 0.1, "rate": 1, "life": 0.1, "spark": false}
		"wind-up-robot":
			_robot(body)
			trail = {"color": Color(0.8, 0.75, 0.65, 0.45), "size": 0.3, "rate": 10, "life": 0.4, "spark": false}
		"marble-roller":
			_marble(body)
			trail = {"color": Color(0.7, 0.85, 1.0, 0.35), "size": 0.3, "rate": 14, "life": 0.4, "spark": false}
		"rc-racer":
			_racer(body)
			trail = {"color": Color(0.85, 0.8, 0.7, 0.55), "size": 0.45, "rate": 22, "life": 0.5, "spark": false}
		"kite-bomber":
			_kite(body)
			trail = {"color": Color(1, 1, 1, 0.3), "size": 0.25, "rate": 8, "life": 0.5, "spark": false}
		"boulder-of-doom":
			_boulder(body)
			trail = {"color": Color(0.7, 0.62, 0.5, 0.6), "size": 0.9, "rate": 20, "life": 1.0, "spark": false}
		"paper-lantern":
			_lantern(body)
			trail = {"color": Color(1.0, 0.75, 0.35, 0.4), "size": 0.25, "rate": 12, "life": 0.6, "spark": false}
		"giant-block":
			_block(body)
			trail = {"color": Color(1, 1, 1, 0.25), "size": 0.5, "rate": 14, "life": 0.5, "spark": false}
		"meteor-marble":
			_meteor(body)
			trail = {"color": Color(1.0, 0.6, 0.2, 0.9), "size": 0.45, "rate": 50, "life": 0.45, "spark": true}
		"pinata":
			_pinata(body)
			trail = {"color": Color(1.0, 0.5, 0.8, 0.8), "size": 0.2, "rate": 40, "life": 0.5, "spark": true}
		"candy-bomb":
			_candy(body)
			trail = {"color": Color(1.0, 0.45, 0.7, 0.8), "size": 0.15, "rate": 30, "life": 0.35, "spark": true}
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
	# A little bulb on top that shows what the mine is doing (see blink_mine).
	var bulb := _mi(_sphere(0.28), Color("ffe14a"), Vector3(0, 1.32, 0), 0.2)
	var bulb_mat := (bulb.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
	bulb_mat.emission_enabled = true
	bulb_mat.emission = Color("ffd21f")
	bulb_mat.emission_energy_multiplier = 0.2
	bulb.material_override = bulb_mat
	bulb.name = "Bulb"
	body.add_child(bulb)


## Show a placed mine's state: the bulb stays dark while it is arming, blinks slowly once armed
## and flashes fast when it has been set off. The jelly glows a little with the bulb.
static func blink_mine(root: Node3D, t: float, armed: bool, triggered: bool) -> void:
	var level := mine_glow(t, armed, triggered)
	var bulb := root.find_child("Bulb", true, false) as MeshInstance3D
	if bulb != null:
		(bulb.material_override as StandardMaterial3D).emission_energy_multiplier = 0.2 + 5.0 * level
		bulb.scale = Vector3.ONE * (0.9 + 0.3 * level)
	var jelly := root.find_child("Jelly", true, false) as MeshInstance3D
	if jelly != null:
		(jelly.material_override as StandardMaterial3D).emission_energy_multiplier = 0.3 + 0.9 * level


## 0..1 brightness of a mine's bulb at time t.
static func mine_glow(t: float, armed: bool, triggered: bool) -> float:
	if triggered:
		return 1.0 if fposmod(t, 0.16) < 0.08 else 0.0
	if not armed:
		return 0.0
	return 1.0 if fposmod(t, 1.2) < 0.25 else 0.0


## A giant wooden mousetrap with a spring bar and a wedge of cheese on the trigger.
static func _trap(body: Node3D) -> void:
	var wood := Color("c99a5b")
	body.add_child(_mi(_box(3.0, 0.3, 1.9), wood, Vector3(0, 0.15, 0), 0.8))
	var bar := _mi(_box(2.6, 0.12, 0.12), Color("b8bcc4"), Vector3(0, 0.55, -0.55), 0.2)
	bar.name = "Bar"
	body.add_child(bar)
	for side in [-1.0, 1.0]:
		body.add_child(_mi(_box(0.1, 0.5, 0.1), Color("b8bcc4"), Vector3(side * 1.3, 0.4, -0.55), 0.2))
	var cheese := _mi(_box(0.8, 0.4, 0.6), YELLOW, Vector3(0.7, 0.5, 0.5), 0.5)
	cheese.rotation.y = 0.4
	body.add_child(cheese)
	for i in 3:
		body.add_child(_mi(_sphere(0.1), Color("d9a21f"), Vector3(0.45 + float(i) * 0.25, 0.72, 0.4 + float(i % 2) * 0.2), 0.5))


## A tin wind-up robot: boxy body, round head with an antenna, legs that swing and a key on its back.
static func _robot(body: Node3D) -> void:
	var tin := Color("b9c2cc")
	body.add_child(_mi(_box(1.5, 1.7, 1.0), tin, Vector3(0, 1.5, 0), 0.3))
	body.add_child(_mi(_sphere(0.65), Color("d9dee4"), Vector3(0, 2.8, 0), 0.3))
	for side in [-1.0, 1.0]:
		body.add_child(_mi(_sphere(0.14), YELLOW, Vector3(side * 0.28, 2.9, 0.55), 0.3))
		var leg := Node3D.new()
		leg.name = "Leg%d" % int(side)
		leg.position = Vector3(side * 0.45, 0.8, 0)
		leg.add_child(_mi(_box(0.5, 1.0, 0.6), RED, Vector3(0, -0.4, 0), 0.4))
		body.add_child(leg)
	var ant := _mi(_cyl(0.05, 0.05, 0.7), BLACK, Vector3(0, 3.7, 0))
	body.add_child(ant)
	body.add_child(_mi(_sphere(0.18), RED, Vector3(0, 4.1, 0), 0.3))
	var key := Node3D.new()
	key.name = "Key"
	key.position = Vector3(0, 1.7, -0.7)
	key.add_child(_mi(_cyl(0.07, 0.07, 0.9), BRASS, Vector3(0, 0, 0)))
	key.add_child(_mi(_box(1.0, 0.18, 0.18), BRASS, Vector3(0, 0.45, 0)))
	key.rotation.x = PI * 0.5
	body.add_child(key)


## A glass marble with a coloured swirl inside.
static func _marble(body: Node3D) -> void:
	var roll := Node3D.new()
	roll.name = "Roll"
	roll.position = Vector3(0, 1.3, 0)
	body.add_child(roll)
	var glass := _mi(_sphere(1.3), Color(0.75, 0.9, 1.0), Vector3.ZERO, 0.05)
	var gm := (glass.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
	gm.emission_enabled = true
	gm.emission = Color(0.4, 0.7, 1.0)
	gm.emission_energy_multiplier = 0.35
	glass.material_override = gm
	roll.add_child(glass)
	for i in 3:
		var a := float(i) * TAU / 3.0
		roll.add_child(_mi(_sphere(0.45, 0.5), Color("ff5fa2") if i % 2 == 0 else YELLOW, Vector3(cos(a) * 0.7, sin(a) * 0.6, sin(a) * 0.4), 0.3))


## A little remote-control car: red body, canopy, four wheels and an aerial. Faces +z.
static func _racer(body: Node3D) -> void:
	body.add_child(_mi(_box(1.5, 0.6, 2.4), RED, Vector3(0, 0.9, 0), 0.3))
	body.add_child(_mi(_box(1.1, 0.5, 1.0), Color("bfe6ff"), Vector3(0, 1.45, -0.2), 0.1))
	for x in [-0.9, 0.9]:
		for z in [-0.8, 0.8]:
			var wheel := Node3D.new()
			wheel.name = "Wheel%d%d" % [int(x * 10.0), int(z * 10.0)]
			wheel.position = Vector3(x, 0.5, z)
			var tyre := _mi(_cyl(0.5, 0.5, 0.4), BLACK, Vector3.ZERO, 0.9)
			tyre.rotation.z = PI * 0.5
			wheel.add_child(tyre)
			body.add_child(wheel)
	var aerial := _mi(_cyl(0.03, 0.03, 1.4), BLACK, Vector3(0.5, 1.9, -0.9))
	aerial.rotation.x = -0.3
	body.add_child(aerial)


## A diamond kite with a ribbon tail and a little bomb slung underneath. Faces +z, flat tilt.
static func _kite(body: Node3D) -> void:
	var sail := _mi(_box(2.6, 0.08, 3.2), Color("ffb347"), Vector3(0, 1.6, 0), 0.7)
	sail.rotation.y = PI * 0.25
	body.add_child(sail)
	var spar := _mi(_box(0.1, 0.1, 4.2), BROWN, Vector3(0, 1.66, 0), 0.7)
	body.add_child(spar)
	for i in 4:
		var rib := _mi(_box(0.5, 0.08, 0.3), RED if i % 2 == 0 else WHITE, Vector3(0, 1.5, -2.0 - float(i) * 0.6), 0.7)
		rib.rotation.y = float(i) * 0.4
		body.add_child(rib)
	body.add_child(_mi(_sphere(0.5), BLACK, Vector3(0, 0.6, 0), 0.4))
	body.add_child(_mi(_cyl(0.04, 0.04, 0.9), BROWN, Vector3(0, 1.1, 0)))


## Per-frame motion for the steered shots: legs march, the key winds, wheels spin, the marble
## rolls, the kite rocks. `t` is seconds; `speed` how fast the shot is moving (voxels/second).
static func animate(root: Node3D, weapon: String, t: float, speed: float) -> void:
	var body := root.get_node_or_null("Body") as Node3D
	if body == null:
		return
	match weapon:
		"wind-up-robot":
			for side in ["-1", "1"]:
				var leg := body.get_node_or_null("Leg" + side) as Node3D
				if leg != null:
					leg.rotation.x = sin(t * 10.0 + (PI if side == "-1" else 0.0)) * 0.6
			var key := body.get_node_or_null("Key") as Node3D
			if key != null:
				key.rotation.y = t * 6.0
			body.rotation.z = sin(t * 10.0) * 0.06
		"marble-roller":
			var roll := body.get_node_or_null("Roll") as Node3D
			if roll != null:
				roll.rotation.x = t * maxf(speed, 4.0) * 0.5
		"rc-racer":
			for w in body.get_children():
				if str(w.name).begins_with("Wheel"):
					(w as Node3D).rotation.x = t * maxf(speed, 4.0) * 0.8
		"kite-bomber":
			body.rotation.z = sin(t * 2.2) * 0.25
			body.rotation.x = sin(t * 1.7) * 0.12


static func _box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(x, y, z)
	return b


## A paper lantern: glowing orange drum with darker ribs, caps and a flame inside.
static func _lantern(body: Node3D) -> void:
	var paper := _mi(_cyl(0.9, 0.9, 1.5), Color("ff9a3c"), Vector3.ZERO, 0.9)
	var pm := (paper.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
	pm.emission_enabled = true
	pm.emission = Color("ffb347")
	pm.emission_energy_multiplier = 1.2
	paper.material_override = pm
	body.add_child(paper)
	for y in [-0.45, 0.0, 0.45]:
		var rib := TorusMesh.new()
		rib.inner_radius = 0.88
		rib.outer_radius = 0.95
		body.add_child(_mi(rib, RED.darkened(0.2), Vector3(0, y, 0), 0.8))
	for y in [-0.8, 0.8]:
		body.add_child(_mi(_cyl(0.6, 0.6, 0.18), DARK_BROWN, Vector3(0, y, 0), 0.8))
	body.add_child(_mi(_cyl(0.03, 0.03, 0.8), BROWN, Vector3(0, 1.3, 0)))


## A giant toy building block: red cube with four studs on top and a yellow stripe.
static func _block(body: Node3D) -> void:
	body.add_child(_mi(_box(4.5, 3.6, 4.5), RED, Vector3.ZERO, 0.4))
	body.add_child(_mi(_box(4.6, 0.7, 4.6), YELLOW, Vector3(0, -0.5, 0), 0.4))
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			body.add_child(_mi(_cyl(0.65, 0.65, 0.5), RED.lightened(0.08), Vector3(sx * 1.1, 2.05, sz * 1.1), 0.4))


## A glowing glass marble falling like a meteor: hot core, blue glass shell.
static func _meteor(body: Node3D) -> void:
	var glass := _mi(_sphere(1.0), Color(0.55, 0.75, 1.0), Vector3.ZERO, 0.05)
	var gm := (glass.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
	gm.emission_enabled = true
	gm.emission = Color(1.0, 0.55, 0.2)
	gm.emission_energy_multiplier = 1.6
	glass.material_override = gm
	body.add_child(glass)
	for i in 3:
		var a := float(i) * TAU / 3.0
		body.add_child(_mi(_sphere(0.35, 0.5), Color("ff5fa2") if i % 2 == 0 else YELLOW, Vector3(cos(a) * 0.5, sin(a) * 0.4, sin(a) * 0.3), 0.3))


## A party pinata: a round striped paper body with ears, a head and a fringe of crepe.
static func _pinata(body: Node3D) -> void:
	var pink := Color("ff5fa2")
	body.add_child(_mi(_sphere(1.5, 0.85), pink, Vector3.ZERO, 0.8))
	for dy in [-0.45, 0.0, 0.45]:
		var band := TorusMesh.new()
		band.inner_radius = 1.2 - absf(dy) * 0.6
		band.outer_radius = 1.4 - absf(dy) * 0.6
		body.add_child(_mi(band, YELLOW if dy == 0.0 else Color("4aa3df"), Vector3(0, dy, 0), 0.8))
	body.add_child(_mi(_sphere(0.8), pink.lightened(0.1), Vector3(1.3, 0.9, 0), 0.8))
	for dz in [-0.4, 0.4]:
		body.add_child(_mi(_cyl(0.05, 0.25, 0.7), YELLOW, Vector3(1.3, 1.7, dz), 0.8))
	body.add_child(_mi(_sphere(0.1), BLACK, Vector3(2.0, 1.05, 0.3), 0.3))
	body.add_child(_mi(_sphere(0.1), BLACK, Vector3(2.0, 1.05, -0.3), 0.3))
	for i in 6:
		var a := float(i) * TAU / 6.0
		body.add_child(_mi(_box(0.18, 0.9, 0.5), GREEN if i % 2 == 0 else YELLOW, Vector3(cos(a) * 0.9, -1.0, sin(a) * 0.9), 0.8))


## A wrapped sweet: round candy with twisted wrapper ends.
static func _candy(body: Node3D) -> void:
	body.add_child(_mi(_sphere(0.55), Color("ff5fa2"), Vector3.ZERO, 0.3))
	for sx in [-1.0, 1.0]:
		var wrap := _mi(_cyl(0.05, 0.4, 0.5), BLUE, Vector3(sx * 0.75, 0, 0), 0.5)
		wrap.rotation.z = deg_to_rad(-90.0 * sx)
		body.add_child(wrap)
	var stripe := TorusMesh.new()
	stripe.inner_radius = 0.5
	stripe.outer_radius = 0.58
	body.add_child(_mi(stripe, WHITE, Vector3.ZERO, 0.3))


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
