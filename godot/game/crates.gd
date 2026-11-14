class_name CrateViews
extends Node3D
## The crates lying on the map (match.start / state `crates`): a wooden box with a bright band for
## a weapon, a pink snack box with a white band for health. A crate first seen drops in from above;
## after that it follows the server (it only ever moves down) and bobs a little so it reads as a
## pickup. A missing id means it was taken or sank.

const Toon := preload("res://game/toon.gd")
const SIZE := 2.6
const DROP_FROM := 45.0
const DROP_SECONDS := 0.9

## A crate that dropped in has just touched down at `at`.
signal landed(at: Vector3)

var _nodes: Dictionary = {}  # id -> Node3D
var _t := 0.0


## `crates` is the snapshot list: [{id, kind, weapon, pos}], pos at the middle of the crate's floor.
## `drop_new` is false for the first list after match.start, so crates already there do not rain in.
func sync(crates: Array, dt: float, drop_new := true) -> void:
	_t += dt
	var seen := {}
	for c in crates:
		var id := int(c["id"])
		seen[id] = true
		var node: Node3D = _nodes.get(id, null)
		var at: Vector3 = c["pos"]
		if node == null:
			node = make(str(c["kind"]))
			_nodes[id] = node
			add_child(node)
			node.position = at
			node.set_meta("fall", DROP_FROM if drop_new else 0.0)
		var was_falling: float = float(node.get_meta("fall", 0.0))
		var fall: float = maxf(0.0, was_falling - DROP_FROM / DROP_SECONDS * dt)
		node.set_meta("fall", fall)
		if was_falling > 0.0 and fall == 0.0:
			landed.emit(at)
		# Follow the server downwards smoothly; the drop-in is only for show.
		node.position = Vector3(at.x, lerpf(node.position.y, at.y, minf(1.0, dt * 12.0)), at.z)
		var body := node.get_node("Body") as Node3D
		body.position.y = SIZE * 0.5 + fall + (0.0 if fall > 0.0 else 0.18 + 0.18 * sin(_t * 2.4 + float(id)))
		body.rotation.y = _t * 0.6 + float(id)
	for id in _nodes.keys():
		if not seen.has(id):
			(_nodes[id] as Node).queue_free()
			_nodes.erase(id)


func clear() -> void:
	for id in _nodes.keys():
		(_nodes[id] as Node).queue_free()
	_nodes.clear()


func count() -> int:
	return _nodes.size()


static func make(kind: String) -> Node3D:
	var health := kind == "health"
	var root := Node3D.new()
	var body := Node3D.new()
	body.name = "Body"
	root.add_child(body)
	var box := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE * SIZE
	box.mesh = mesh
	box.material_override = _mat(Color("ff8fb0") if health else Color("c98a4b"))
	body.add_child(box)
	# Two bands, like ribbon on a parcel.
	var band_color := Color("fff8ea") if health else Color("ffd24a")
	for axis in 2:
		var band := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(SIZE * 1.04, SIZE * 1.04, SIZE * 0.22) if axis == 0 else Vector3(SIZE * 0.22, SIZE * 1.04, SIZE * 1.04)
		band.mesh = bm
		band.material_override = _mat(band_color)
		body.add_child(band)
	return root


static func _mat(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.albedo_color = color
	m.roughness = 0.8
	return m
