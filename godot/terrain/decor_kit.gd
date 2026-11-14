## Detail meshes for decor anchors (shared/src/terrain3d/prefab.ts): one Mesh per kind, built once
## and shared by every instance through a MultiMesh. Library models (CC0, godot/assets/thirdparty)
## are used where we have them, restyled to Storybook; the rest are small kit-bashed shapes.
##
## Local frame of every mesh: the origin is the centre of the anchor voxel's face it sticks out of,
## +z points out of that face and +y is up. For anchors on top of a voxel (face 4) +z is a turn
## picked from the anchor's variant, so props do not all face the same way.
extends RefCounted

const Toon := preload("res://game/toon.gd")
const Style := preload("res://assets/storybook_style.gd")

const LIB := "res://assets/thirdparty/polyhaven/"

## Library models by kind: [path, height in world units].
const MODELS := {
	"lamp-post": [LIB + "street_lamp_01/street_lamp_01.gltf", 10.0],
	"lamp-wall": [LIB + "Lantern_01/Lantern_01.gltf", 1.6],
	"hanging-lantern": [LIB + "Lantern_01/Lantern_01.gltf", 1.4],
	"ceiling-lamp": [LIB + "Lantern_01/Lantern_01.gltf", 1.2],
	"bench": [LIB + "painted_wooden_bench/painted_wooden_bench.gltf", 2.6],
	"barrels": [LIB + "Barrel_01/Barrel_01.gltf", 2.6],
	"oil-barrels": [LIB + "Barrel_01/Barrel_01.gltf", 2.6],
	"crates": [LIB + "wooden_crate_01/wooden_crate_01.gltf", 2.0],
	"fish-crates": [LIB + "wooden_crate_01/wooden_crate_01.gltf", 1.6],
	"ice-crate": [LIB + "wooden_crate_01/wooden_crate_01.gltf", 1.4],
	"planter": [LIB + "planter_pot_clay/planter_pot_clay.gltf", 1.6],
	"potted-tree": [LIB + "planter_pot_clay/planter_pot_clay.gltf", 1.8],
	"well-bucket": [LIB + "wooden_bucket_01/wooden_bucket_01.gltf", 1.2],
	"paint-pots": [LIB + "wooden_bucket_01/wooden_bucket_01.gltf", 1.0],
}

## Kinds whose instances take a per-anchor colour (shutters, doors, flags...): only the surfaces
## built with PAINT get it.
const PAINT := Color(1, 1, 1, 0)

const PALETTE := [
	Color("3f7fd0"), Color("d8483c"), Color("f2c14a"), Color("4f9e5a"),
	Color("8a5cc2"), Color("f4f1e8"), Color("2f4d6e"), Color("e07a3a"),
]

const WOOD := Color("8a5a36")
const DARK_WOOD := Color("5a3a24")
const IRON := Color("3b3f47")
const WHITE := Color("f6f3ea")
const TERRACOTTA := Color("c8643c")
const LEAF := Color("4f9e3a")
const LEAF_DARK := Color("2f7a34")
const ROPE := Color("c9a56a")
const NET := Color("4b6a5a")
const STONE := Color("9a9aa2")
const RED := Color("d8483c")

static var _meshes: Dictionary = {}
static var _materials: Dictionary = {}


## Colour for an anchor's variant byte.
static func paint_for(v: int) -> Color:
	return PALETTE[v % PALETTE.size()]


## The mesh for a kind, or null when the kind has no detail (yet).
static func mesh_for(kind: String) -> Mesh:
	if _meshes.has(kind):
		return _meshes[kind]
	var m: Mesh = null
	if MODELS.has(kind):
		m = _model(MODELS[kind][0], float(MODELS[kind][1]), kind)
	if m == null:
		m = _built(kind)
	_meshes[kind] = m
	return m


## True when a kind's instance colour should be the variant paint.
static func painted(kind: String) -> bool:
	return kind in ["window", "attic-window", "window-arched", "door", "awning", "bunting",
		"flagpole", "bow-flag", "stern-flag", "sign", "sign-cafe", "sign-baker", "sign-inn",
		"sign-chandler", "sign-warehouse", "market-sign", "stall-awning", "moored-boat", "house-number",
		"flowerbox", "planter-flowers", "flowers", "lifeboat"]


## Where the mesh origin goes for an anchor, relative to the anchor face point.
static func lift(kind: String) -> float:
	match kind:
		"moored-boat":
			return 0.0
	return 0.0


# --------------------------------------------------------------------------------- library models

static func _model(path: String, height: float, kind: String) -> Mesh:
	if not ResourceLoader.exists(path):
		return null
	var node := Style.instance(path, {"height": height})
	if node == null:
		return null
	var out := ArrayMesh.new()
	var box := Style.bounds(node)
	# Stand the model on the anchor face, centred, and bake every surface into one mesh.
	var shift := Vector3(-(box.position.x + box.size.x * 0.5), -box.position.y, -(box.position.z + box.size.z * 0.5)) * node.scale
	var hang := kind in ["hanging-lantern", "ceiling-lamp"]
	if hang:
		shift.y = -box.end.y * node.scale.y
	if kind == "lamp-wall":
		shift.z += box.size.z * 0.5 * node.scale.z + 0.3
		shift.y += 3.0
	_bake(node, Transform3D(Basis.from_scale(node.scale), shift), out)
	node.free()
	return out


static func _bake(root: Node3D, xf: Transform3D, out: ArrayMesh) -> void:
	var stack: Array = [[root, Transform3D.IDENTITY]]
	while not stack.is_empty():
		var item: Array = stack.pop_back()
		var n: Node = item[0]
		var t: Transform3D = item[1]
		if n != root and n is Node3D:
			t = t * (n as Node3D).transform
		for c in n.get_children():
			stack.append([c, t])
		var mi := n as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var st := SurfaceTool.new()
			st.append_from(mi.mesh, i, xf * t)
			st.set_material(mi.get_active_material(i))
			st.commit(out)


# ---------------------------------------------------------------------------- kit-bashed shapes

## Parts are [PrimitiveMesh, Transform3D, Color]. One surface per colour.
static func _assemble(parts: Array) -> ArrayMesh:
	var groups := {}
	for p in parts:
		var key: Color = p[2]
		if not groups.has(key):
			groups[key] = []
		groups[key].append(p)
	var out := ArrayMesh.new()
	for key in groups:
		var st := SurfaceTool.new()
		for p in groups[key]:
			var prim: PrimitiveMesh = p[0]
			st.append_from(prim, 0, p[1])
		st.set_material(_material(key))
		st.commit(out)
	return out


static func _material(c: Color) -> Material:
	if _materials.has(c):
		return _materials[c]
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.roughness = 1.0
	if c == PAINT:
		# Takes the instance colour (the anchor's variant paint).
		m.vertex_color_use_as_albedo = true
		m.albedo_color = Color.WHITE
	else:
		m.albedo_color = c
	if c == Color("ffe9a8"):
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = 1.5
	_materials[c] = m
	return m


static func _box(sx: float, sy: float, sz: float, at: Vector3, c: Color, rot := Basis()) -> Array:
	var b := BoxMesh.new()
	b.size = Vector3(sx, sy, sz)
	return [b, Transform3D(rot, at), c]


static func _cyl(r: float, h: float, at: Vector3, c: Color, rot := Basis(), top := -1.0, sides := 10) -> Array:
	var m := CylinderMesh.new()
	m.bottom_radius = r
	m.top_radius = r if top < 0.0 else top
	m.height = h
	m.radial_segments = sides
	m.rings = 1
	return [m, Transform3D(rot, at), c]


static func _ball(r: float, at: Vector3, c: Color, squash := 1.0) -> Array:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0 * squash
	m.radial_segments = 10
	m.rings = 6
	return [m, Transform3D(Basis(), at), c]


static func _torus(r_in: float, r_out: float, at: Vector3, c: Color, rot := Basis()) -> Array:
	var m := TorusMesh.new()
	m.inner_radius = r_in
	m.outer_radius = r_out
	m.rings = 16
	m.ring_segments = 8
	return [m, Transform3D(rot, at), c]


## Window frame for a hole `w` wide and `h` tall starting half a voxel above the anchor face point
## (the anchor is the sill voxel), with a sill, a cross bar and open shutters in the paint colour.
static func _window(w: float, h: float, shutters: bool) -> Array:
	var p: Array = []
	var cy := 0.5 + h * 0.5
	var t := 0.28
	p.append(_box(w + 0.6, t, 0.35, Vector3(0, 0.5 + h + t * 0.5 - 0.05, 0.12), WHITE))
	p.append(_box(t, h + 0.4, 0.35, Vector3(-w * 0.5 - t * 0.5 + 0.05, cy, 0.12), WHITE))
	p.append(_box(t, h + 0.4, 0.35, Vector3(w * 0.5 + t * 0.5 - 0.05, cy, 0.12), WHITE))
	p.append(_box(w + 1.0, 0.25, 0.7, Vector3(0, 0.45, 0.3), WHITE))
	p.append(_box(0.14, h, 0.12, Vector3(0, cy, -0.4), WHITE))
	p.append(_box(w, 0.14, 0.12, Vector3(0, cy + h * 0.1, -0.4), WHITE))
	if shutters:
		for s in [-1.0, 1.0]:
			var sx: float = s * (w * 0.5 + 0.35 + w * 0.25)
			p.append(_box(w * 0.5, h, 0.15, Vector3(sx, cy, 0.25), PAINT))
			for k in 3:
				p.append(_box(w * 0.5 - 0.15, 0.08, 0.05, Vector3(sx, cy - h * 0.3 + k * h * 0.3, 0.35), PAINT))
	return p


static func _built(kind: String) -> Mesh:
	var p: Array = []
	match kind:
		"window":
			p = _window(3.0, 4.0, true)
		"window-arched":
			p = _window(3.0, 4.0, false)
			p.append(_cyl(1.8, 0.3, Vector3(0, 4.6, 0.12), WHITE, Basis(Vector3.RIGHT, PI * 0.5)))
		"attic-window":
			p = _window(3.0, 3.0, false)
		"porthole", "window-round":
			p.append(_torus(0.9, 1.3, Vector3(0, 1.5, 0.1), Color("c9a24a"), Basis(Vector3.RIGHT, PI * 0.5)))
		"shop-window":
			p.append(_box(8.0, 0.3, 0.9, Vector3(0, 0.6, 0.4), WOOD))
			for k in 4:
				p.append(_box(0.9, 0.9, 0.9, Vector3(-2.7 + k * 1.8, 1.2, -0.6), PALETTE[k]))
		"door":
			# A door leaf standing open against the reveal, a frame, a lintel and a step lamp.
			p.append(_box(5.6, 0.4, 0.4, Vector3(0, 8.7, 0.15), WHITE))
			p.append(_box(0.35, 8.2, 0.4, Vector3(-2.75, 4.6, 0.15), WHITE))
			p.append(_box(0.35, 8.2, 0.4, Vector3(2.75, 4.6, 0.15), WHITE))
			p.append(_box(0.3, 7.6, 2.4, Vector3(-2.3, 4.3, -1.3), PAINT))
			p.append(_ball(0.15, Vector3(-2.05, 4.3, -2.2), Color("c9a24a")))
		"awning":
			for k in 7:
				var c := WHITE if k % 2 == 0 else PAINT
				p.append(_box(1.0, 0.15, 3.0, Vector3(-3.0 + k, 0.7, 1.4), c, Basis(Vector3.RIGHT, -0.35)))
		"stall-awning":
			for k in 7:
				p.append(_box(1.0, 0.12, 2.2, Vector3(-3.0 + k, 3.6, -0.4), WHITE if k % 2 == 0 else PAINT, Basis(Vector3.RIGHT, -0.25)))
		"sign", "sign-cafe", "sign-baker", "sign-inn", "sign-chandler", "sign-warehouse", "house-number":
			var small := kind == "house-number"
			p.append(_box(0.15, 0.15, 1.6, Vector3(0, 0.0, 0.8), IRON))
			p.append(_box(0.12 if small else 0.15, 1.0 if small else 1.8, 0.8 if small else 1.4, Vector3(0, -1.0, 1.1), PAINT, Basis(Vector3.UP, PI * 0.5)))
			if kind == "sign-inn":
				p.append(_ball(0.5, Vector3(0, -1.0, 1.1), Color("f2c14a")))
		"market-sign":
			p.append(_box(14.0, 2.2, 0.3, Vector3(0, 1.4, 0.2), PAINT))
			p.append(_box(14.6, 0.3, 0.4, Vector3(0, 2.6, 0.2), WHITE))
		"clock-face":
			p.append(_cyl(2.2, 0.3, Vector3(0, 0, 0.2), WHITE, Basis(Vector3.RIGHT, PI * 0.5), -1.0, 20))
			p.append(_box(0.2, 1.6, 0.1, Vector3(0, 0.6, 0.4), IRON))
			p.append(_box(1.2, 0.2, 0.1, Vector3(0.5, 0, 0.4), IRON))
		"flowerbox":
			p.append(_box(3.4, 0.7, 0.8, Vector3(0, 0.15, 0.75), WOOD))
			for k in 4:
				p.append(_ball(0.45, Vector3(-1.2 + k * 0.8, 0.75, 0.75), LEAF if k % 2 == 0 else LEAF_DARK))
				p.append(_ball(0.22, Vector3(-1.2 + k * 0.8, 1.1, 0.55), PAINT))
		"planter-flowers", "planter-veg", "flowers":
			var veg := kind == "planter-veg"
			for k in 5:
				var a := float(k) * 1.3
				var at := Vector3(cos(a) * 0.9, 0.9, sin(a) * 0.9)
				p.append(_ball(0.55, at, LEAF if k % 2 == 0 else LEAF_DARK))
				p.append(_ball(0.25, at + Vector3(0, 0.45, 0), Color("e0603a") if veg else PAINT))
		"tree", "fruit-tree":
			p.append(_cyl(0.45, 5.0, Vector3(0, 2.5, 0), DARK_WOOD, Basis(), 0.3))
			p.append(_ball(2.6, Vector3(0, 6.0, 0), LEAF, 0.85))
			p.append(_ball(1.9, Vector3(1.4, 7.2, 0.6), LEAF_DARK, 0.9))
			p.append(_ball(1.7, Vector3(-1.3, 7.0, -0.8), LEAF, 0.9))
			if kind == "fruit-tree":
				for k in 5:
					p.append(_ball(0.3, Vector3(cos(k * 1.3) * 2.2, 5.6 + (k % 2), sin(k * 1.3) * 2.2), RED))
		"bush":
			p.append(_ball(1.4, Vector3(0, 0.9, 0), LEAF_DARK, 0.75))
			p.append(_ball(1.0, Vector3(0.9, 1.1, 0.4), LEAF, 0.8))
		"rock":
			p.append(_ball(1.2, Vector3(0, 0.4, 0), STONE, 0.6))
			p.append(_ball(0.7, Vector3(0.9, 0.3, 0.5), STONE, 0.7))
		"railing", "gallery-rail", "stair-rail", "handrail", "parapet-cap":
			# Posts only: DecorView links neighbouring posts with "rail-bar-*" pieces.
			var col := IRON if kind == "gallery-rail" else WHITE
			p.append(_box(0.25, 2.6, 0.25, Vector3(0, 1.8, 0), col))
			p.append(_ball(0.2, Vector3(0, 3.15, 0), col))
		"rope-rail", "ferry-rail":
			var c2 := WHITE if kind == "ferry-rail" else DARK_WOOD
			p.append(_cyl(0.18, 2.6, Vector3(0, 1.8, 0), c2))
			p.append(_ball(0.22, Vector3(0, 3.15, 0), c2))
		"rail-bar-white", "rail-bar-iron":
			# Unit-length span along +x from a post to its neighbour (scaled along x by the gap).
			var colb := IRON if kind == "rail-bar-iron" else WHITE
			p.append(_box(1.0, 0.22, 0.22, Vector3(0.5, 3.0, 0), colb))
			p.append(_box(1.0, 0.14, 0.14, Vector3(0.5, 1.9, 0), colb))
		"rail-bar-rope":
			p.append(_box(1.0, 0.12, 0.12, Vector3(0.5, 2.75, 0), ROPE))
			p.append(_box(1.0, 0.1, 0.1, Vector3(0.5, 2.0, 0), ROPE))
		"chimney-pot":
			p.append(_cyl(0.5, 1.2, Vector3(-0.6, 1.1, 0), TERRACOTTA, Basis(), 0.4))
			p.append(_cyl(0.5, 1.5, Vector3(0.6, 1.25, 0), TERRACOTTA, Basis(), 0.4))
		"downpipe":
			p.append(_cyl(0.2, 10.0, Vector3(0, -5.0, 0.3), IRON))
		"weathervane", "lightning-rod":
			p.append(_cyl(0.08, 3.0, Vector3(0, 2.0, 0), IRON))
			if kind == "weathervane":
				p.append(_box(1.6, 0.6, 0.06, Vector3(0.4, 3.0, 0), IRON))
				p.append(_ball(0.2, Vector3(0, 3.6, 0), Color("c9a24a")))
		"flagpole", "bow-flag", "stern-flag":
			var hgt := 14.0 if kind == "flagpole" else 5.0
			p.append(_cyl(0.15, hgt, Vector3(0, hgt * 0.5 + 0.5, 0), WHITE))
			p.append(_box(hgt * 0.3, hgt * 0.18, 0.05, Vector3(hgt * 0.15 + 0.1, hgt * 0.85, 0), PAINT))
			p.append(_ball(0.3, Vector3(0, hgt + 0.6, 0), Color("c9a24a")))
		"bunting":
			for k in 9:
				var x := -8.0 + k * 2.0
				var droop := 0.06 * (64.0 - x * x)
				p.append(_box(1.0, 1.0, 0.04, Vector3(x, 7.0 - droop * 0.4, 0), PALETTE[k % 4], Basis(Vector3.BACK, PI * 0.25)))
		"net-hung", "cargo-nets", "net-pile":
			if kind == "net-pile":
				p.append(_ball(1.3, Vector3(0, 0.5, 0), NET, 0.5))
			else:
				p.append(_box(3.5, 3.0, 0.1, Vector3(0, 0, 0.2), NET))
			for k in 3:
				p.append(_ball(0.25, Vector3(-1.2 + k * 1.2, 1.3, 0.35), Color("e86a3a")))
		"lobster-pots", "eel-baskets", "smoke-racks":
			for k in 3:
				p.append(_cyl(0.7, 1.0, Vector3(-1.5 + k * 1.5, 0.5 + 0.0 * k, 0), Color("b88a52"), Basis(Vector3.FORWARD, PI * 0.5)))
			p.append(_cyl(0.7, 1.0, Vector3(-0.75, 1.6, 0), Color("b88a52"), Basis(Vector3.FORWARD, PI * 0.5)))
		"rope-coil", "coil-rope":
			p.append(_torus(0.3, 0.9, Vector3(0, 0.2, 0), ROPE))
			p.append(_torus(0.25, 0.7, Vector3(0, 0.45, 0), ROPE))
		"bollard":
			p.append(_cyl(0.6, 1.4, Vector3(0, 0.7, 0), IRON))
			p.append(_cyl(0.85, 0.3, Vector3(0, 1.45, 0), IRON))
		"lifebuoy":
			p.append(_torus(0.55, 1.0, Vector3(0, 0, 0.3), RED, Basis(Vector3.RIGHT, PI * 0.5)))
			for k in 4:
				p.append(_box(0.5, 0.48, 0.48, Vector3(cos(k * PI * 0.5) * 0.78, sin(k * PI * 0.5) * 0.78, 0.3), WHITE))
		"moored-boat", "lifeboat":
			# A little rowing boat: tapered hull, a thwart, oars.
			for k in 6:
				var z := -2.5 + k
				var half := 1.2 - absf(z) * 0.25
				p.append(_box(half * 2.0, 0.9, 1.0, Vector3(0, 0.3, z), PAINT))
			p.append(_box(1.8, 0.6, 5.0, Vector3(0, -0.2, 0), WHITE))
			p.append(_box(2.0, 0.15, 0.6, Vector3(0, 0.6, 0.5), WOOD))
			p.append(_box(0.12, 0.12, 4.5, Vector3(0.6, 0.75, -0.3), WOOD, Basis(Vector3.UP, 0.25)))
		"crane-hook":
			p.append(_cyl(0.06, 14.0, Vector3(0, -7.0, 0), IRON))
			p.append(_torus(0.15, 0.45, Vector3(0, -14.2, 0), IRON))
			p.append(_box(2.0, 1.4, 2.0, Vector3(0, -15.4, 0), WOOD))
		"crane-ladder", "hatch-ladder":
			p.append(_box(0.12, 10.0, 0.12, Vector3(-0.5, 0, 0.3), IRON))
			p.append(_box(0.12, 10.0, 0.12, Vector3(0.5, 0, 0.3), IRON))
			for k in 10:
				p.append(_box(1.0, 0.1, 0.1, Vector3(0, -4.5 + k, 0.3), IRON))
		"warning-light":
			p.append(_ball(0.4, Vector3(0, 0.4, 0), Color("ffe9a8")))
		"lens":
			p.append(_cyl(1.6, 3.4, Vector3(0, 1.7, 0), Color("ffe9a8"), Basis(), 1.2, 12))
			p.append(_cyl(1.9, 0.3, Vector3(0, 0.15, 0), Color("c9a24a"), Basis(), -1.0, 12))
		"bell", "fog-bell":
			p.append(_box(0.2, 3.0, 0.2, Vector3(-1.0, 1.5, 0), DARK_WOOD))
			p.append(_box(0.2, 3.0, 0.2, Vector3(1.0, 1.5, 0), DARK_WOOD))
			p.append(_box(2.4, 0.25, 0.25, Vector3(0, 3.0, 0), DARK_WOOD))
			p.append(_cyl(0.75, 1.2, Vector3(0, 2.2, 0), Color("c9a24a"), Basis(), 0.35))
		"telescope-stand", "telescope":
			p.append(_cyl(0.1, 2.4, Vector3(0, 1.2, 0), IRON))
			p.append(_cyl(0.25, 2.0, Vector3(0, 2.6, 0.4), Color("c9a24a"), Basis(Vector3.RIGHT, 1.2), 0.15))
		"gangway-rail", "plaque", "ivy", "gutter", "funnel-smoke", "smoke", "hatch":
			pass
		"rug":
			p.append(_box(4.0, 0.08, 3.0, Vector3(0, 0.04, 0), Color("b8493c")))
		"table-set", "counter-goods", "fish-stall", "oyster-bar", "crab-tank", "scales":
			# Kept simple on purpose: a few goods on the surface.
			for k in 3:
				p.append(_ball(0.3, Vector3(-0.8 + k * 0.8, 0.3, 0), [Color("9fc7d8"), Color("e0603a"), WHITE][k], 0.6))
		"market-cart", "deck-chair", "deck-chairs", "veg-plot", "garden-shed", "fence-run", "chicken-coop", "log-pile", "washing-line", "notice-board", "sawhorse", "lumber-stack", "tool-rack", "winch", "ship-anchor", "name-board", "ships-wheel", "radar-mast", "horn", "snack-counter", "bench-seat":
			p = _misc(kind)
	if p.is_empty():
		return null
	return _assemble(p)


static func _misc(kind: String) -> Array:
	var p: Array = []
	match kind:
		"market-cart":
			p.append(_box(3.0, 1.0, 2.0, Vector3(0, 1.4, 0), WOOD))
			p.append(_cyl(0.6, 0.2, Vector3(0, 0.6, 1.1), DARK_WOOD, Basis(Vector3.RIGHT, PI * 0.5)))
			p.append(_cyl(0.6, 0.2, Vector3(0, 0.6, -1.1), DARK_WOOD, Basis(Vector3.RIGHT, PI * 0.5)))
			for k in 4:
				p.append(_ball(0.4, Vector3(-1.0 + k * 0.7, 2.1, 0), PALETTE[k + 1]))
		"deck-chair", "deck-chairs":
			p.append(_box(1.0, 0.1, 1.6, Vector3(0, 0.6, 0), PAINT, Basis(Vector3.RIGHT, 0.5)))
		"veg-plot":
			p.append(_box(5.0, 0.4, 3.0, Vector3(0, 0.2, 0), DARK_WOOD))
			for k in 6:
				p.append(_ball(0.35, Vector3(-2.0 + (k % 3) * 2.0, 0.6, -0.8 + (k / 3) * 1.6), LEAF))
		"garden-shed":
			p.append(_box(3.0, 3.0, 3.0, Vector3(0, 1.5, 0), WOOD))
			p.append(_box(3.6, 0.3, 3.6, Vector3(0, 3.1, 0), DARK_WOOD))
		"fence-run":
			for k in 5:
				p.append(_box(0.2, 1.6, 0.2, Vector3(-4.0 + k * 2.0, 0.8, 0), WHITE))
			p.append(_box(8.2, 0.2, 0.15, Vector3(0, 1.2, 0), WHITE))
		"chicken-coop":
			p.append(_box(2.4, 1.6, 1.8, Vector3(0, 1.2, 0), RED))
			p.append(_ball(0.3, Vector3(1.6, 0.3, 0.5), WHITE))
		"log-pile":
			for k in 3:
				p.append(_cyl(0.35, 2.4, Vector3(-0.7 + k * 0.7, 0.35, 0), WOOD, Basis(Vector3.RIGHT, PI * 0.5)))
		"washing-line":
			p.append(_cyl(0.1, 4.0, Vector3(-4.0, 2.0, 0), WOOD))
			p.append(_cyl(0.1, 4.0, Vector3(4.0, 2.0, 0), WOOD))
			p.append(_cyl(0.03, 8.0, Vector3(0, 3.8, 0), WHITE, Basis(Vector3.FORWARD, PI * 0.5)))
			for k in 5:
				p.append(_box(0.9, 1.1, 0.05, Vector3(-3.0 + k * 1.5, 3.1, 0), PALETTE[(k * 3) % 8]))
		"notice-board":
			p.append(_box(0.2, 3.0, 0.2, Vector3(-1.0, 1.5, 0), WOOD))
			p.append(_box(0.2, 3.0, 0.2, Vector3(1.0, 1.5, 0), WOOD))
			p.append(_box(2.4, 1.6, 0.15, Vector3(0, 2.4, 0), DARK_WOOD))
			p.append(_box(0.6, 0.8, 0.05, Vector3(-0.5, 2.4, 0.1), WHITE))
		"sawhorse", "lumber-stack", "tool-rack":
			for k in 3:
				p.append(_box(4.0, 0.3, 0.6, Vector3(0, 0.3 + k * 0.3, -0.6 + k * 0.6), WOOD))
		"winch", "ship-anchor":
			p.append(_cyl(0.5, 1.6, Vector3(0, 0.8, 0), IRON, Basis(Vector3.FORWARD, PI * 0.5)))
		"name-board":
			p.append(_box(6.0, 1.0, 0.1, Vector3(0, 0, 0.1), WHITE))
		"ships-wheel":
			p.append(_torus(0.5, 0.7, Vector3(0, 2.2, 0), WOOD, Basis(Vector3.RIGHT, PI * 0.5)))
		"radar-mast", "horn":
			p.append(_cyl(0.12, 4.0, Vector3(0, 2.0, 0), WHITE))
		"snack-counter", "bench-seat":
			pass
	return p
