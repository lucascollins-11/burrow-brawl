class_name Hats
extends RefCounted
## Eight procedural low-poly Squirmling hats in bright clay colours (see the concept sheet). Each
## hat is built with its base centred on the origin, y up, facing +z, sized for a head ring of
## about 0.8 units: put the node on the head ring's top. `accent` is the team colour; hats that
## have a fixed look (chef white, cone orange) only use it for small details.
##
## API: Hats.IDS, Hats.make(id, accent) -> Node3D, Hats.canonical(id) -> String, Hats.default_for_team(i).

const IDS: Array[String] = ["miner", "chef", "cone", "propeller", "crown", "pirate", "flowerpot", "bucket"]
## Names older data used, mapped to the new ids.
const ALIASES := {"pot": "flowerpot", "party": "bucket", "tricorn": "pirate", "helmet": "miner"}

const GOLD := Color("f6c945")
const WHITE := Color("fff6e6")
const ORANGE := Color("ff7a1a")
const INK := Color("2d2420")
const TERRACOTTA := Color("d9774a")
const STEEL := Color("9fb3c4")
const LEAF := Color("56b865")

static var _mats: Dictionary = {}


static func default_for_team(team: int) -> String:
	return IDS[posmod(team, IDS.size())]


## The id this build knows for any hat name, falling back to the bucket for unknown names.
static func canonical(id: String) -> String:
	var key := id.to_lower()
	if ALIASES.has(key):
		key = ALIASES[key]
	return key if IDS.has(key) else "bucket"


static func make(id: String, accent: Color = Color("e85d4a")) -> Node3D:
	var hat := Node3D.new()
	hat.name = "Hat"
	var kind := canonical(id)
	hat.set_meta("hat_id", kind)
	match kind:
		"miner":
			_miner(hat, accent)
		"chef":
			_chef(hat, accent)
		"cone":
			_cone(hat)
		"propeller":
			_propeller(hat, accent)
		"crown":
			_crown(hat, accent)
		"pirate":
			_pirate(hat, accent)
		"flowerpot":
			_flowerpot(hat, accent)
		_:
			_bucket(hat, accent)
	return hat


# ------------------------------------------------------------------ hats


## Gold hard hat with a brim and a lamp on the front.
static func _miner(hat: Node3D, accent: Color) -> void:
	var shell := _part(_sphere(0.7, true), GOLD)
	hat.add_child(shell)
	var brim := _part(_cyl(0.82, 0.82, 0.07, 24), GOLD, Vector3(0, 0.02, 0))
	hat.add_child(brim)
	var ridge := _part(_box(Vector3(0.16, 0.08, 1.2)), accent, Vector3(0, 0.66, 0))
	hat.add_child(ridge)
	var lamp := _part(_cyl(0.2, 0.2, 0.14, 16), STEEL, Vector3(0, 0.34, 0.66))
	lamp.rotation.x = deg_to_rad(90.0)
	hat.add_child(lamp)
	var bulb := _part(_sphere(0.14), Color("fffbe0"), Vector3(0, 0.34, 0.76), 0.2, Color("fff1a8"))
	bulb.name = "Lamp"
	hat.add_child(bulb)


## Tall white chef hat with a pleated band and a cloud of puffs.
static func _chef(hat: Node3D, accent: Color) -> void:
	hat.add_child(_part(_cyl(0.5, 0.52, 0.34, 20), WHITE, Vector3(0, 0.12, 0)))
	hat.add_child(_part(_cyl(0.54, 0.54, 0.08, 20), accent, Vector3(0, 0.0, 0)))
	var puffs := [Vector3(0, 0.62, 0), Vector3(0.3, 0.52, 0.12), Vector3(-0.3, 0.52, 0.12), Vector3(0.0, 0.5, -0.3)]
	for i in range(puffs.size()):
		var p := _part(_sphere(0.34 if i == 0 else 0.28), WHITE, puffs[i])
		p.scale = Vector3(1.0, 0.9, 1.0)
		hat.add_child(p)


## Orange traffic cone with a white stripe and a square base rim.
static func _cone(hat: Node3D) -> void:
	hat.add_child(_part(_cyl(0.06, 0.52, 1.0), ORANGE, Vector3(0, 0.5, 0), 0.85))
	hat.add_child(_part(_cyl(0.3, 0.38, 0.2), WHITE, Vector3(0, 0.46, 0)))
	hat.add_child(_part(_box(Vector3(1.0, 0.07, 1.0)), Color("ff9a3d"), Vector3(0, 0.0, 0)))


## Baseball cap with a button and a spinning two-blade propeller (child node "Propeller").
static func _propeller(hat: Node3D, accent: Color) -> void:
	hat.add_child(_part(_sphere(0.7, true), accent))
	var brim := _part(_cyl(0.5, 0.5, 0.06, 20), GOLD, Vector3(0, 0.02, 0.5))
	brim.scale = Vector3(1.2, 1.0, 0.8)
	hat.add_child(brim)
	hat.add_child(_part(_sphere(0.1), GOLD, Vector3(0, 0.7, 0)))
	hat.add_child(_part(_cyl(0.035, 0.035, 0.26), STEEL, Vector3(0, 0.82, 0)))
	var spin := Node3D.new()
	spin.name = "Propeller"
	spin.position = Vector3(0, 0.98, 0)
	hat.add_child(spin)
	spin.add_child(_part(_box(Vector3(0.62, 0.04, 0.14)), Color("e8392b"), Vector3(0.31, 0, 0)))
	spin.add_child(_part(_box(Vector3(0.62, 0.04, 0.14)), Color("3b8fe0"), Vector3(-0.31, 0, 0)))


## Gold crown: a band with five points and a red gem on the front.
static func _crown(hat: Node3D, accent: Color) -> void:
	hat.add_child(_part(_cyl(0.52, 0.46, 0.34, 20), GOLD, Vector3(0, 0.15, 0)))
	for i in range(5):
		var a := float(i) / 5.0 * TAU
		var tip := _part(_cyl(0.0, 0.12, 0.32, 8), GOLD, Vector3(sin(a) * 0.45, 0.5, cos(a) * 0.45))
		hat.add_child(tip)
		hat.add_child(_part(_sphere(0.06), accent, Vector3(sin(a) * 0.45, 0.68, cos(a) * 0.45)))
	hat.add_child(_part(_sphere(0.1), Color("e8392b"), Vector3(0, 0.15, 0.5), 0.2, Color("ff5a4a")))


## Black tricorn with gold trim and a team-coloured feather.
static func _pirate(hat: Node3D, accent: Color) -> void:
	var tri := _part(_cyl(0.78, 0.9, 0.42, 3), INK, Vector3(0, 0.2, 0))
	tri.rotation.y = deg_to_rad(90.0)  # one point faces front
	hat.add_child(tri)
	hat.add_child(_part(_cyl(0.5, 0.56, 0.3, 12), INK, Vector3(0, 0.5, 0)))
	var trim := _part(_cyl(0.8, 0.92, 0.06, 3), GOLD, Vector3(0, 0.0, 0))
	trim.rotation.y = deg_to_rad(90.0)
	hat.add_child(trim)
	hat.add_child(_part(_sphere(0.12), WHITE, Vector3(0, 0.26, 0.78)))
	var feather := _part(_sphere(0.2), accent, Vector3(0.45, 0.6, -0.1))
	feather.scale = Vector3(0.5, 1.4, 0.3)
	feather.rotation.z = deg_to_rad(-25.0)
	hat.add_child(feather)


## A terracotta flowerpot worn upside right, with a little plant sprouting from it.
static func _flowerpot(hat: Node3D, accent: Color) -> void:
	hat.add_child(_part(_cyl(0.52, 0.38, 0.5), TERRACOTTA, Vector3(0, 0.22, 0)))
	hat.add_child(_part(_cyl(0.58, 0.58, 0.14), Color("e8895c"), Vector3(0, 0.5, 0)))
	hat.add_child(_part(_cyl(0.46, 0.46, 0.04), Color("6b4a32"), Vector3(0, 0.58, 0)))
	hat.add_child(_part(_cyl(0.03, 0.03, 0.4), LEAF, Vector3(0, 0.78, 0)))
	for s in [-1.0, 1.0]:
		var leaf := _part(_sphere(0.16), LEAF, Vector3(s * 0.16, 0.9, 0))
		leaf.scale = Vector3(1.4, 0.4, 0.8)
		leaf.rotation.z = deg_to_rad(25.0 * s)
		hat.add_child(leaf)
	hat.add_child(_part(_sphere(0.12), accent, Vector3(0, 1.0, 0), 0.7))


## A steel bucket worn upside down, with its handle flopped to one side.
static func _bucket(hat: Node3D, accent: Color) -> void:
	hat.add_child(_part(_cyl(0.42, 0.56, 0.62, 20), STEEL, Vector3(0, 0.3, 0), 0.5))
	hat.add_child(_part(_cyl(0.6, 0.6, 0.07, 20), Color("b9cad8"), Vector3(0, 0.0, 0), 0.5))
	hat.add_child(_part(_cyl(0.44, 0.44, 0.04, 20), Color("7f95a8"), Vector3(0, 0.62, 0), 0.5))
	var handle := _part(_torus(0.2, 0.25), accent, Vector3(0.0, 0.66, 0))
	handle.scale = Vector3(1.4, 1.0, 1.4)
	hat.add_child(handle)


# ------------------------------------------------------------------ helpers


static func _mat(color: Color, roughness: float, glow: Color) -> StandardMaterial3D:
	var key := "%s/%s/%s" % [color.to_html(), roughness, glow.to_html()]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	if glow.a > 0.0:
		m.emission_enabled = true
		m.emission = glow
		m.emission_energy_multiplier = 1.2
	_mats[key] = m
	return m


static func _part(mesh: Mesh, color: Color, pos := Vector3.ZERO, roughness := 0.85, glow := Color(0, 0, 0, 0)) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _mat(color, roughness, glow)
	mi.position = pos
	return mi


static func _sphere(radius: float, hemi := false) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius if hemi else radius * 2.0
	s.is_hemisphere = hemi
	s.radial_segments = 16
	s.rings = 8
	return s


static func _cyl(top: float, bottom: float, h: float, segs := 16) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = h
	c.radial_segments = segs
	return c


static func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


static func _torus(inner: float, outer: float) -> TorusMesh:
	var t := TorusMesh.new()
	t.inner_radius = inner
	t.outer_radius = outer
	return t
