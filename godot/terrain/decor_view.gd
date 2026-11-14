## Draws the decor anchors of match.start (`terrain.decor`): detail meshes hung on solid voxels,
## one MultiMesh per kind. No collision: the voxels are the gameplay. When a terrain patch turns an
## anchor's voxel to air, its detail breaks off: the instance is hidden and a copy tumbles down and
## shrinks away. Built once per match; only patches change it.
extends Node3D

const Kit := preload("res://terrain/decor_kit.gd")
const Life := preload("res://terrain/decor_life.gd")

## Most broken-off pieces animated per patch (the rest just vanish).
const MAX_DEBRIS := 24
## Rail posts on top faces that get linked to their neighbours by a bar (post kind -> bar kind).
const RAIL_BARS := {
	"railing": "rail-bar-white", "parapet-cap": "rail-bar-white", "gallery-rail": "rail-bar-iron",
	"rope-rail": "rail-bar-rope", "ferry-rail": "rail-bar-white",
}
## Longest gap (squared, in voxels) a rail bar spans.
const RAIL_SPAN2 := 13

var _store: RefCounted = null
var _kinds := {}  # kind -> {mm: MultiMesh, node: MultiMeshInstance3D, xf: Array[Transform3D]}
var _by_voxel := {}  # voxel index -> Array of [kind, instance]
var _broken := {}  # "kind:instance" -> true
var life: Node3D = null
var anchors := 0
var shown := 0
var broken := 0


## Build from the decor list. `store` is the VoxelStore (for sizes, sea level and solidity).
func build(decor: Array, store: RefCounted) -> void:
	_clear()
	_store = store
	anchors = decor.size()
	var per_kind := {}
	for d in decor:
		var a: Dictionary = d
		var kind := str(a.get("kind", ""))
		if Kit.mesh_for(kind) == null:
			continue
		if not per_kind.has(kind):
			per_kind[kind] = []
		per_kind[kind].append(a)
	for kind in RAIL_BARS:
		if per_kind.has(kind):
			var bars := rail_bars(per_kind[kind])
			if not bars.is_empty():
				per_kind[RAIL_BARS[kind]] = bars
	for kind in per_kind:
		var list: Array = per_kind[kind]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = Kit.painted(kind)
		mm.mesh = Kit.mesh_for(kind)
		mm.instance_count = list.size()
		var xfs: Array[Transform3D] = []
		for i in list.size():
			var a: Dictionary = list[i]
			var xf: Transform3D = a["xf"] if a.has("xf") else place(a, store)
			xfs.append(xf)
			mm.set_instance_transform(i, xf)
			if mm.use_colors:
				mm.set_instance_color(i, Kit.paint_for(int(a.get("v", 0))))
			var vi := _index(int(a["x"]), int(a["y"]), int(a["z"]))
			if vi >= 0:
				if not _by_voxel.has(vi):
					_by_voxel[vi] = []
				_by_voxel[vi].append([kind, i])
		var node := MultiMeshInstance3D.new()
		node.name = "Decor_" + kind
		node.multimesh = mm
		add_child(node)
		_kinds[kind] = {"mm": mm, "node": node, "xf": xfs}
		shown += list.size()
	life = Life.new()
	life.name = "Life"
	add_child(life)
	life.setup(self)


## kind -> {mm, node, xf} for the kinds this view draws (DecorLife animates some of them).
func kind_table() -> Dictionary:
	return _kinds


func is_broken(kind: String, i: int) -> bool:
	return _broken.has(kind + ":" + str(i))


## Bars between neighbouring rail posts on top faces, as anchors with a ready transform: each post
## links to every same-level post within reach on its +x side (or straight +z), unless a third
## post sits between them. Bars break with the post they start from.
static func rail_bars(posts: Array) -> Array:
	var at := {}
	for a in posts:
		if int(a.get("face", 4)) == 4:
			at[Vector3i(int(a["x"]), int(a["y"]), int(a["z"]))] = true
	var out := []
	for p: Vector3i in at:
		for dx in range(0, 4):
			for dz in range(-3, 4):
				if (dx == 0 and dz <= 0) or dx * dx + dz * dz > RAIL_SPAN2:
					continue
				var q := p + Vector3i(dx, 0, dz)
				if not at.has(q) or _blocked(at, p, q):
					continue
				var len := sqrt(float(dx * dx + dz * dz))
				var basis := Basis(Vector3.UP, atan2(-float(dz), float(dx))) * Basis.from_scale(Vector3(len, 1, 1))
				out.append({"x": p.x, "y": p.y, "z": p.z, "face": 4,
					"xf": Transform3D(basis, Vector3(p) + Vector3(0, 0.5, 0))})
	return out


## True when another post sits between p and q (the angle at it is about square or wider).
static func _blocked(at: Dictionary, p: Vector3i, q: Vector3i) -> bool:
	var d2 := (q - p).length_squared()
	if d2 <= 2:
		return false
	for dx in range(-3, 4):
		for dz in range(-3, 4):
			var b := p + Vector3i(dx, 0, dz)
			if b == p or b == q or not at.has(b):
				continue
			if (b - p).length_squared() + (q - b).length_squared() <= d2 + 1:
				return true
	return false


## World transform for one anchor: origin on the face of its voxel, +z out of that face.
static func place(a: Dictionary, store: RefCounted) -> Transform3D:
	var p := Vector3(float(a["x"]), float(a["y"]), float(a["z"]))
	var face := int(a.get("face", 4))
	var v := int(a.get("v", 0))
	var kind := str(a.get("kind", ""))
	var out := Vector3.UP
	match face:
		0:
			out = Vector3.RIGHT
		1:
			out = Vector3.BACK
		2:
			out = Vector3.LEFT
		3:
			out = Vector3.FORWARD
		5:
			out = Vector3.DOWN
	var basis: Basis
	if face >= 4:
		# Props on top (or hanging below) turn by a quarter step picked from the variant.
		basis = Basis(Vector3.UP, float(v & 3) * PI * 0.5 + float((v >> 2) & 7) * 0.08)
	else:
		basis = Basis.looking_at(-out, Vector3.UP)
	var origin := p + out * 0.5
	if kind == "moored-boat" and store != null:
		# Boats float alongside: a few voxels out from the quay or pier, on the sea.
		origin = p + out * 3.5
		origin.y = float(store.get("sea_y")) - 0.2
	return Transform3D(basis, origin)


## A terrain.patch arrived (already applied to the store): drop detail whose voxel is now air.
## Returns how many pieces broke off.
func on_patch(msg: Dictionary) -> int:
	if _store == null or _by_voxel.is_empty():
		return 0
	var x0 := int(msg.get("x0", 0))
	var y0 := int(msg.get("y0", 0))
	var z0 := int(msg.get("z0", 0))
	var sx := int(msg.get("sx", 0))
	var sy := int(msg.get("sy", 0))
	var sz := int(msg.get("sz", 0))
	var n := 0
	for y in range(y0, y0 + sy):
		for z in range(z0, z0 + sz):
			for x in range(x0, x0 + sx):
				var vi := _index(x, y, z)
				if vi < 0 or not _by_voxel.has(vi) or _store.call("is_solid", x, y, z):
					continue
				for item in _by_voxel[vi]:
					_break(str(item[0]), int(item[1]), n < MAX_DEBRIS)
					n += 1
				_by_voxel.erase(vi)
	broken += n
	shown -= n
	if n > 0 and life != null:
		life.refresh()
	return n


func _break(kind: String, i: int, animate: bool) -> void:
	var k: Dictionary = _kinds[kind]
	var mm: MultiMesh = k["mm"]
	var xf: Transform3D = (k["xf"] as Array)[i]
	_broken[kind + ":" + str(i)] = true
	mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), xf.origin))
	if not animate or not is_inside_tree():
		return
	var piece := MeshInstance3D.new()
	piece.mesh = mm.mesh
	piece.transform = xf
	add_child(piece)
	var spin := Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3))
	var drift := Vector3(randf_range(-3, 3), 0.0, randf_range(-3, 3)) + xf.basis.z * 3.0
	var t := create_tween().set_parallel(true)
	t.tween_property(piece, "position", xf.origin + drift + Vector3(0, -14, 0), 1.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	t.tween_property(piece, "rotation", piece.rotation + spin, 1.3)
	t.tween_property(piece, "scale", Vector3.ONE * 0.2, 1.3).set_delay(0.5)
	t.chain().tween_callback(piece.queue_free)


func _index(x: int, y: int, z: int) -> int:
	var sx := int(_store.get("size_x"))
	var sy := int(_store.get("size_y"))
	var sz := int(_store.get("size_z"))
	if x < 0 or y < 0 or z < 0 or x >= sx or y >= sy or z >= sz:
		return -1
	return (y * sz + z) * sx + x


func _clear() -> void:
	for c in get_children():
		c.queue_free()
	_kinds.clear()
	_by_voxel.clear()
	_broken.clear()
	life = null
	anchors = 0
	shown = 0
	broken = 0
