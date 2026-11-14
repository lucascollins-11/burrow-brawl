## Storybook scenery: thousands of small props scattered over the island (grass tufts, flowers,
## mushrooms, bushes, stones, fences, toy blocks, gumdrops, gears, library models...) plus ambient
## life (birds circling overhead, butterflies over the flowers). Purely visual: Squirmlings walk
## through it and shots ignore it. Props over ground a blast removes fall away with the ground.
##
## Procedural props are drawn with one MultiMesh per primitive shape (per-instance colour, a sway
## for foliage), so even big maps stay cheap. Library models (godot/assets/thirdparty) are a few
## dozen ordinary nodes restyled by StorybookStyle.
##
##   scenery.setup(theme_id, size_x, size_z, sea_y, ground_y_callable, seed, density)
##   scenery.on_patch(terrain_patch_msg)   # after the terrain applied it
class_name Scenery
extends Node3D

const Style := preload("res://assets/storybook_style.gd")
const SHADER := preload("res://game/scenery.gdshader")
const Bird := preload("res://game/scenery_life.gd")

enum Shape { SPHERE, CYL, CONE, CAP, BOX }

## Props per 256 x 256 voxels of map at density 1.0, by kind. Each theme picks a set. The small
## props were cut by 30% after a playtest; big set pieces carry the detail instead.
const SETS := {
	"garden": {
		"tuft": 2520, "flowers": 1050, "mushroom": 75, "bush": 180, "stone": 125, "fence": 50,
		"library": 90,
	},
	"toy": {"block": 490, "cone": 180, "ball": 210, "flag": 65, "stone": 85, "library": 70},
	"bath": {"bubbles": 630, "soap": 180, "duck": 50, "sponge": 85, "tuft": 420, "library": 45},
	"candy": {"sprinkle": 1820, "gumdrop": 265, "candle": 85, "cherry": 140, "flowers": 420, "library": 24},
	"brass": {"gear": 295, "bolt": 630, "pipe": 100, "tuft": 980, "stone": 180, "library": 70},
	# Lighthouse Village carries its own detail (decor anchors), and props would land on its
	# roofs and quays: just a little grass and flowers.
	"village": {"tuft": 700, "flowers": 300, "bush": 40},
}
const THEME_SET := {
	"garden-patch": "garden", "picnic-atoll": "garden", "toybox-harbor": "toy",
	"bathtub-bay": "bath", "frosted-bakery": "candy", "clockwork-mesa": "brass",
	"lighthouse-village": "village",
}
const BUTTERFLIES := ["garden", "candy", "village"]
## Library models that fit the Storybook set, with their height in world units (Squirmling = 6).
const LIBRARY := {
	"garden": [
		["Barrel_01", 3.2], ["wooden_bucket_01", 2.2], ["painted_wooden_bench", 3.4],
		["street_lamp_01", 14.0], ["planter_pot_clay", 3.0], ["Lantern_01", 2.6],
		["shrub_03", 4.2], ["shrub_02", 4.6], ["shrub_sorrel_01", 2.4], ["fern_02", 3.2],
		["tree_stump_01", 3.4], ["rock_09", 3.6], ["rock_07", 4.2], ["planter_box_01", 2.6],
		["weed_plant_02", 2.6], ["potted_plant_04", 2.4],
	],
	"toy": [
		["wooden_crate_01", 2.4], ["Barrel_01", 3.2], ["wooden_barrels_01", 3.6],
		["wooden_bucket_01", 2.2], ["ocean_buoy", 4.4], ["Lantern_01", 2.6],
		["painted_wooden_bench", 3.4], ["street_lamp_01", 14.0], ["planter_box_01", 2.6],
	],
	"bath": [
		["ocean_buoy", 4.4], ["lambis_shell", 1.8], ["wooden_bucket_01", 2.2],
		["potted_plant_04", 2.4], ["anthurium_botany_01", 3.4], ["fern_02", 3.2],
	],
	"candy": [
		["Lantern_01", 2.6], ["planter_pot_clay", 3.0], ["potted_plant_04", 2.4],
		["painted_wooden_bench", 3.4],
	],
	"brass": [
		["Barrel_01", 3.2], ["wooden_barrels_01", 3.6], ["wooden_crate_01", 2.4],
		["street_lamp_01", 14.0], ["Lantern_01", 2.6], ["wooden_bucket_01", 2.2],
		["rock_09", 3.6], ["rock_07", 4.2], ["tree_stump_01", 3.4],
	],
}
const BUCKET := 16.0

var sea_y := 0.0
var prop_count := 0
var _ground: Callable
var _rng := RandomNumberGenerator.new()
var _meshes: Array[Mesh] = []
## Per shape: transforms, colours and custom data of every instance, then the MultiMesh.
var _xf: Array = []
var _col: Array = []
var _cus: Array = []
var _mm: Array[MultiMesh] = []
## Placed props: { pos: Vector3, parts: [[shape, index], ...], node: Node3D or null }.
var _props: Array = []
var _buckets := {}  # Vector2i -> Array of prop indices
var _life: Node3D
var _set := "garden"


## Props stay out of this radius around each spot in `keep_clear` (Squirmling start positions), and
## thin out to a third up to CLEAR_FADE, so players stay readable and have room to walk.
const CLEAR_RADIUS := 9.0
const CLEAR_FADE := 20.0
## Fillers taller than this would hide a Squirmling (6 tall); only library props and flags may be.
const MAX_FILLER_HEIGHT := 4.5


func setup(theme: String, size_x: float, size_z: float, sea: float, ground_y: Callable, seed_value: int, density := 1.0, keep_clear: Array = []) -> void:
	clear()
	sea_y = sea
	_ground = ground_y
	_rng.seed = seed_value
	_build_meshes()
	var set_id: String = THEME_SET.get(theme, "garden")
	_set = set_id
	var area := size_x * size_z / 65536.0
	var kinds: Dictionary = SETS[set_id]
	var flower_spots: Array[Vector3] = []
	for kind: String in kinds:
		var want := int(round(float(kinds[kind]) * area * density))
		var tries := want * 6
		var placed := 0
		while placed < want and tries > 0:
			tries -= 1
			var x := _rng.randf_range(3.0, size_x - 3.0)
			var z := _rng.randf_range(3.0, size_z - 3.0)
			if _crowded(x, z, keep_clear):
				continue
			var y := float(_ground.call(x, z))
			if y < sea_y + 1.8 or not _gentle(x, z, y, 2.0 if kind == "library" else 3.0):
				continue
			var at := Vector3(x, y - 0.15, z)
			if kind == "library":
				_add_library(at)
			else:
				_add_parts(at, _parts(kind))
			if kind == "flowers" and flower_spots.size() < 64:
				flower_spots.append(at)
			placed += 1
	_commit()
	prop_count = _props.size()
	_life = Bird.new()
	add_child(_life)
	_life.call("setup", size_x, size_z, sea_y, set_id in BUTTERFLIES, flower_spots, seed_value)


func clear() -> void:
	for c in get_children():
		c.free()
	_xf.clear()
	_col.clear()
	_cus.clear()
	_mm.clear()
	_props.clear()
	_buckets.clear()
	prop_count = 0


## Drop the props whose ground a terrain patch removed (or buried). Returns how many went.
func on_patch(msg: Dictionary) -> int:
	if _props.is_empty() or not _ground.is_valid():
		return 0
	var x0 := float(msg.get("x0", 0))
	var z0 := float(msg.get("z0", 0))
	var x1 := x0 + float(msg.get("sx", 0))
	var z1 := z0 + float(msg.get("sz", 0))
	var gone := 0
	for bx in range(int(floor(x0 / BUCKET)), int(floor(x1 / BUCKET)) + 1):
		for bz in range(int(floor(z0 / BUCKET)), int(floor(z1 / BUCKET)) + 1):
			for i: int in _buckets.get(Vector2i(bx, bz), []):
				var p: Dictionary = _props[i]
				if p.is_empty():
					continue
				var pos: Vector3 = p["pos"]
				if pos.x < x0 or pos.x > x1 or pos.z < z0 or pos.z > z1:
					continue
				var y := float(_ground.call(pos.x, pos.z))
				if absf(y - 0.15 - pos.y) < 0.6:
					continue
				for part: Array in p["parts"]:
					var mm: MultiMesh = _mm[part[0]]
					mm.set_instance_transform(part[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
				var node: Node3D = p["node"]
				if node != null:
					node.queue_free()
				_props[i] = {}
				gone += 1
	prop_count -= gone
	return gone


func _crowded(x: float, z: float, keep_clear: Array) -> bool:
	for spot: Vector3 in keep_clear:
		var d := Vector2(x - spot.x, z - spot.z).length()
		if d < CLEAR_RADIUS:
			return true
		if d < CLEAR_FADE and _rng.randf() < 0.66:
			return true
	return false


func _gentle(x: float, z: float, y: float, limit: float) -> bool:
	var dx := absf(float(_ground.call(x + 1.5, z)) - y) + absf(float(_ground.call(x - 1.5, z)) - y)
	var dz := absf(float(_ground.call(x, z + 1.5)) - y) + absf(float(_ground.call(x, z - 1.5)) - y)
	return dx + dz < limit


func _register(at: Vector3, parts: Array, node: Node3D) -> void:
	var i := _props.size()
	_props.append({"pos": at, "parts": parts, "node": node})
	var key := Vector2i(int(floor(at.x / BUCKET)), int(floor(at.z / BUCKET)))
	if not _buckets.has(key):
		_buckets[key] = []
	_buckets[key].append(i)


## parts: [[shape, local Transform3D, Color, sway], ...]
func _add_parts(at: Vector3, parts: Array) -> void:
	var turn := Basis(Vector3.UP, _rng.randf() * TAU)
	var phase := _rng.randf()
	var refs := []
	for part: Array in parts:
		var shape: int = part[0]
		var local: Transform3D = part[1]
		var xf := Transform3D(turn, at) * local
		refs.append([shape, (_xf[shape] as Array).size()])
		(_xf[shape] as Array).append(xf)
		(_col[shape] as Array).append(part[2])
		(_cus[shape] as Array).append(Color(float(part[3]), at.y, phase, 0.0))
	_register(at, refs, null)


func _add_library(at: Vector3) -> void:
	var list: Array = LIBRARY.get(_set, LIBRARY["garden"])
	var pick: Array = list[_rng.randi() % list.size()]
	var id := str(pick[0])
	var path := "res://assets/thirdparty/polyhaven/%s/%s.gltf" % [id, id]
	var node := Style.instance(path, {"height": float(pick[1])})
	if node == null:
		return
	var box := Style.bounds(node)
	node.position = at - Vector3(0, box.position.y * node.scale.y, 0)
	node.rotation.y = _rng.randf() * TAU
	add_child(node)
	_register(at, [], node)


func _build_meshes() -> void:
	_meshes.clear()
	var s := SphereMesh.new()
	s.radius = 0.5
	s.height = 1.0
	s.radial_segments = 12
	s.rings = 6
	var c := CylinderMesh.new()
	c.top_radius = 0.5
	c.bottom_radius = 0.5
	c.height = 1.0
	c.radial_segments = 8
	c.rings = 1
	var k := CylinderMesh.new()
	k.top_radius = 0.0
	k.bottom_radius = 0.5
	k.height = 1.0
	k.radial_segments = 6
	k.rings = 1
	var h := SphereMesh.new()
	h.radius = 0.5
	h.height = 0.5
	h.is_hemisphere = true
	h.radial_segments = 16
	h.rings = 6
	var b := BoxMesh.new()
	_meshes = [s, c, k, h, b]
	for i in _meshes.size():
		_xf.append([])
		_col.append([])
		_cus.append([])


func _commit() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = SHADER
	for shape in _meshes.size():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.use_custom_data = true
		mm.mesh = _meshes[shape]
		var xs: Array = _xf[shape]
		mm.instance_count = xs.size()
		for i in xs.size():
			mm.set_instance_transform(i, xs[i])
			mm.set_instance_color(i, _col[shape][i])
			mm.set_instance_custom_data(i, _cus[shape][i])
		_mm.append(mm)
		if xs.is_empty():
			continue
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Scenery%s" % Shape.keys()[shape]
		mmi.multimesh = mm
		mmi.material_override = mat
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shape != Shape.CONE else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)
	_xf.clear()
	_col.clear()
	_cus.clear()


# ------------------------------------------------------------------ prop kinds


static func _p(shape: int, pos: Vector3, size: Vector3, color: String, sway := 0.0, rot := Vector3.ZERO) -> Array:
	var basis := Basis.from_euler(rot).scaled(size)
	# Picked as sRGB like every other colour in the game; the shader works in linear.
	return [shape, Transform3D(basis, pos), Color(color).srgb_to_linear(), sway]


func _pick(colors: Array) -> String:
	return colors[_rng.randi() % colors.size()]


func _parts(kind: String) -> Array:
	var r := _rng
	var out := []
	match kind:
		"tuft":
			var greens := ["4fb83f", "6ccf4a", "3c9a3a", "8bdc5a"]
			for i in r.randi_range(3, 6):
				var h := r.randf_range(0.9, 2.0)
				var lean := Vector3(r.randf_range(-0.35, 0.35), 0, r.randf_range(-0.35, 0.35))
				out.append(_p(Shape.CONE, Vector3(r.randf_range(-0.6, 0.6), h * 0.5, r.randf_range(-0.6, 0.6)), Vector3(0.28, h, 0.28), _pick(greens), 1.0, lean))
		"flowers":
			var blooms := ["ffd23f", "ff7aa8", "ffffff", "7ab8ff", "ff9a3d", "c98bff"]
			var bloom := _pick(blooms)
			for i in r.randi_range(3, 7):
				var h := r.randf_range(0.8, 1.9)
				var off := Vector3(r.randf_range(-1.3, 1.3), 0, r.randf_range(-1.3, 1.3))
				out.append(_p(Shape.CYL, off + Vector3(0, h * 0.5, 0), Vector3(0.12, h, 0.12), "3f9a3a", 1.0))
				out.append(_p(Shape.SPHERE, off + Vector3(0, h, 0), Vector3(0.62, 0.42, 0.62), bloom if r.randf() < 0.7 else _pick(blooms), 1.0))
				out.append(_p(Shape.SPHERE, off + Vector3(0, h + 0.12, 0), Vector3(0.22, 0.2, 0.22), "ffe36a", 1.0))
		"mushroom":
			var s := r.randf_range(0.6, 1.2)
			var h := r.randf_range(1.2, 2.6) * s
			out.append(_p(Shape.CYL, Vector3(0, h * 0.5, 0), Vector3(0.6, h, 0.6) * Vector3(s, 1, s), "fff3dc"))
			out.append(_p(Shape.CAP, Vector3(0, h, 0), Vector3(2.6, 2.0, 2.6) * s, _pick(["e8483f", "f29a38", "b65ad9", "e85d9a"])))
			for i in 5:
				var a := float(i) * TAU / 5.0 + r.randf()
				out.append(_p(Shape.SPHERE, Vector3(cos(a) * 0.75 * s, h + 0.42 * s, sin(a) * 0.75 * s), Vector3(0.35, 0.18, 0.35) * s, "fffaf0"))
			if r.randf() < 0.5:
				out.append(_p(Shape.CYL, Vector3(1.1 * s, h * 0.25, 0.3), Vector3(0.3, h * 0.5, 0.3), "fff3dc"))
				out.append(_p(Shape.CAP, Vector3(1.1 * s, h * 0.5, 0.3), Vector3(1.1, 0.9, 1.1), _pick(["e8483f", "f29a38"])))
		"bush":
			var leaf := _pick(["5fbf4a", "79cf52", "4aa84a", "3f9a52"])
			for i in r.randi_range(3, 5):
				var s := r.randf_range(1.3, 2.6)
				out.append(_p(Shape.SPHERE, Vector3(r.randf_range(-1.2, 1.2), s * 0.38, r.randf_range(-1.2, 1.2)), Vector3(s, s * 0.82, s), leaf, 0.25))
			if r.randf() < 0.5:
				for i in 4:
					out.append(_p(Shape.SPHERE, Vector3(r.randf_range(-1.2, 1.2), r.randf_range(1.0, 1.8), r.randf_range(-1.2, 1.2)), Vector3.ONE * 0.4, _pick(["e8483f", "ffd23f", "ffffff"]), 0.25))
		"stone":
			var s := r.randf_range(0.7, 1.8)
			out.append(_p(Shape.SPHERE, Vector3(0, s * 0.18, 0), Vector3(s * 1.5, s * 0.7, s), _pick(["b9a7c4", "a898b8", "c9b3a0"])))
			if r.randf() < 0.6:
				out.append(_p(Shape.SPHERE, Vector3(s * 0.9, s * 0.1, 0.4), Vector3(s * 0.7, s * 0.4, s * 0.6), _pick(["b9a7c4", "a898b8"])))
		"fence":
			var n := r.randi_range(3, 6)
			for i in n:
				out.append(_p(Shape.BOX, Vector3(float(i) * 1.8, 1.0, 0), Vector3(0.45, 2.0, 0.45), "a87048"))
				out.append(_p(Shape.CONE, Vector3(float(i) * 1.8, 2.2, 0), Vector3(0.6, 0.45, 0.6), "a87048"))
			out.append(_p(Shape.BOX, Vector3(float(n - 1) * 0.9, 1.45, 0), Vector3(float(n - 1) * 1.8 + 0.4, 0.28, 0.22), "c48a5a"))
			out.append(_p(Shape.BOX, Vector3(float(n - 1) * 0.9, 0.75, 0), Vector3(float(n - 1) * 1.8 + 0.4, 0.28, 0.22), "c48a5a"))
		"block":
			var calm := ["e8a59c", "efd99a", "a9bfdf", "afd6b2", "f4efe6"]
			var s := r.randf_range(0.8, 1.7)
			out.append(_p(Shape.BOX, Vector3(0, s * 0.5, 0), Vector3.ONE * s, _pick(calm)))
			if r.randf() < 0.35:
				var t := s * r.randf_range(0.5, 0.7)
				out.append(_p(Shape.BOX, Vector3(0, s + t * 0.5, 0), Vector3.ONE * t, _pick(calm), 0.0, Vector3(0, r.randf(), 0)))
		"cone":
			out.append(_p(Shape.CONE, Vector3(0, 1.0, 0), Vector3(1.3, 2.0, 1.3), "eba67a"))
			out.append(_p(Shape.CYL, Vector3(0, 0.95, 0), Vector3(0.85, 0.3, 0.85), "fbf6ee"))
			out.append(_p(Shape.BOX, Vector3(0, 0.1, 0), Vector3(1.7, 0.2, 1.7), "eba67a"))
		"ball":
			var s := r.randf_range(0.8, 1.6)
			out.append(_p(Shape.SPHERE, Vector3(0, s * 0.5, 0), Vector3.ONE * s, _pick(["e8a59c", "efd99a", "a9bfdf", "afd6b2"])))
			out.append(_p(Shape.CYL, Vector3(0, s * 0.5, 0), Vector3(s * 1.02, s * 0.2, s * 1.02), "ffffff"))
		"flag":
			out.append(_p(Shape.CYL, Vector3(0, 2.5, 0), Vector3(0.15, 5.0, 0.15), "ffffff"))
			out.append(_p(Shape.BOX, Vector3(0.9, 4.3, 0), Vector3(1.8, 1.1, 0.08), _pick(["e8a59c", "efd99a", "a9bfdf", "afd6b2"]), 0.8))
		"bubbles":
			for i in r.randi_range(2, 6):
				var s := r.randf_range(0.4, 1.6)
				out.append(_p(Shape.SPHERE, Vector3(r.randf_range(-1.4, 1.4), s * 0.5 + r.randf() * 0.6, r.randf_range(-1.4, 1.4)), Vector3.ONE * s, _pick(["e6f7ff", "ffffff", "d6ecff", "f4e4f0"]), 0.15))
		"soap":
			out.append(_p(Shape.BOX, Vector3(0, 0.45, 0), Vector3(2.4, 0.9, 1.5), _pick(["f7b6d6", "c9a3ea", "a6e3d0", "fff1b0"])))
			out.append(_p(Shape.SPHERE, Vector3(0, 0.95, 0), Vector3(1.6, 0.3, 1.0), "ffffff"))
		"duck":
			var c := _pick(["ffd23f", "ff9a3d", "7ab8ff"])
			out.append(_p(Shape.SPHERE, Vector3(0, 0.8, 0), Vector3(2.0, 1.4, 1.5), c))
			out.append(_p(Shape.SPHERE, Vector3(0.7, 1.9, 0), Vector3(1.1, 1.1, 1.1), c))
			out.append(_p(Shape.CONE, Vector3(1.35, 1.85, 0), Vector3(0.45, 0.6, 0.45), "f28a2e", 0.0, Vector3(0, 0, -PI / 2)))
			out.append(_p(Shape.SPHERE, Vector3(0.95, 2.1, 0.35), Vector3.ONE * 0.18, "2a2433"))
		"sponge":
			out.append(_p(Shape.BOX, Vector3(0, 0.8, 0), Vector3(3.0, 1.6, 2.0), _pick(["ffe36a", "f7b06a"])))
			for i in 6:
				out.append(_p(Shape.SPHERE, Vector3(r.randf_range(-1.2, 1.2), 1.62, r.randf_range(-0.8, 0.8)), Vector3(0.4, 0.12, 0.4), "d9a640"))
		"sprinkle":
			for i in r.randi_range(2, 5):
				out.append(_p(Shape.CYL, Vector3(r.randf_range(-1.2, 1.2), 0.18, r.randf_range(-1.2, 1.2)), Vector3(0.3, 1.0, 0.3), _pick(["f7b3c8", "b3dcf2", "f5e3a6", "c4e6b0", "d9c4f0", "ffffff"]), 0.0, Vector3(PI / 2, r.randf() * TAU, 0)))
		"gumdrop":
			var s := r.randf_range(0.55, 1.05)
			out.append(_p(Shape.CAP, Vector3(0, 0, 0), Vector3(2.0, 3.0, 2.0) * s, _pick(["f2a7bf", "a9d3ee", "efd99a", "bfe0a8", "d4bdf0"])))
		"candle":
			var c := _pick(["ff8fb0", "8fd6ff", "fff1b0", "c9a3ea"])
			out.append(_p(Shape.CYL, Vector3(0, 1.5, 0), Vector3(0.6, 3.0, 0.6), c))
			out.append(_p(Shape.CYL, Vector3(0, 1.5, 0), Vector3(0.64, 0.4, 0.64), "ffffff"))
			out.append(_p(Shape.SPHERE, Vector3(0, 3.35, 0), Vector3(0.3, 0.6, 0.3), "ffcf4a", 0.6))
		"cherry":
			out.append(_p(Shape.SPHERE, Vector3(0, 0.8, 0), Vector3.ONE * 1.6, "d9233f"))
			out.append(_p(Shape.CYL, Vector3(0.3, 2.0, 0), Vector3(0.12, 1.4, 0.12), "4f8a2e", 0.5, Vector3(0, 0, -0.4)))
		"gear":
			var s := r.randf_range(1.0, 2.2)
			var c := _pick(["c9a23a", "b5673a", "d9b45a"])
			out.append(_p(Shape.CYL, Vector3(0, 0.25 * s, 0), Vector3(2.0 * s, 0.5 * s, 2.0 * s), c))
			for i in 8:
				var a := float(i) * TAU / 8.0
				out.append(_p(Shape.BOX, Vector3(cos(a) * 1.1 * s, 0.25 * s, sin(a) * 1.1 * s), Vector3(0.5, 0.5, 0.5) * s, c, 0.0, Vector3(0, -a, 0)))
			out.append(_p(Shape.CYL, Vector3(0, 0.3 * s, 0), Vector3(0.5 * s, 0.62 * s, 0.5 * s), "6d5a52"))
		"bolt":
			out.append(_p(Shape.CYL, Vector3(0, 0.3, 0), Vector3(0.9, 0.6, 0.9), _pick(["c9a23a", "9c7a2b"])))
			out.append(_p(Shape.CYL, Vector3(0, 0.8, 0), Vector3(0.4, 0.6, 0.4), "b5b0a8"))
		"pipe":
			var h := r.randf_range(2.0, 5.0)
			out.append(_p(Shape.CYL, Vector3(0, h * 0.5, 0), Vector3(0.9, h, 0.9), "b5673a"))
			out.append(_p(Shape.CYL, Vector3(0.9, h, 0), Vector3(0.9, 1.8, 0.9), "b5673a", 0.0, Vector3(0, 0, PI / 2)))
			out.append(_p(Shape.CYL, Vector3(0, h * 0.6, 0), Vector3(1.1, 0.3, 1.1), "c9a23a"))
	return out
