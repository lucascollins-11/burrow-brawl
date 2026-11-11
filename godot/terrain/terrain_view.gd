## Draws a VoxelStore: one MeshInstance3D per 32^3 chunk (1 voxel = 1 Godot unit, y up). Chunks are
## meshed in WorkerThreadPool; results are swapped in from _process. Stale results are dropped.
extends Node3D

signal chunk_meshed(chunk_index: int, msec: float)
signal all_meshed

const Store := preload("res://terrain/voxel_store.gd")
const Mesher := preload("res://terrain/surface_mesher.gd")
const TerrainMaterial := preload("res://terrain/terrain_material.gd")

## Max meshing tasks running at once.
@export var max_in_flight := 4
## Max finished meshes turned into scene nodes per frame.
@export var max_swaps_per_frame := 6

var store: Store
var material: Material

var _nodes := {}  # chunk index -> MeshInstance3D
var _dirty := {}  # chunk index -> true, waiting for a free worker slot
var _serial := {}  # chunk index -> latest request serial
var _next_serial := 1
var _in_flight := 0
var _done: Array = []
var _mutex := Mutex.new()
var _busy := false


## Show a freshly loaded store (e.g. from match.start). Replaces whatever was shown.
func set_store(new_store: Store) -> void:
	_clear()
	store = new_store
	if store == null:
		return
	if material == null:
		material = TerrainMaterial.make(float(store.sea_y), float(store.bedrock_y))
	for ci in range(store.chunk_count()):
		_dirty[ci] = true
	_busy = true


## Decode the `terrain` object of match.start and show it. Returns false if it is invalid.
func load_terrain(match_start_terrain: Dictionary) -> bool:
	var new_store := Store.new()
	if not new_store.load_full(match_start_terrain):
		return false
	set_store(new_store)
	return true


## Surface height (world units) at world x, z: where the density crosses the solid threshold.
func ground_y(x: float, z: float) -> float:
	if store == null:
		return 0.0
	return store.ground_height(x, z)


## Apply a terrain.patch message and remesh what it touches.
func apply_patch(msg: Dictionary) -> void:
	if store == null:
		return
	for ci in store.apply_patch(msg):
		_dirty[ci] = true
		_busy = true


## Chunks still waiting for or running a mesh job.
func pending() -> int:
	return _dirty.size() + _in_flight


func _process(_delta: float) -> void:
	if store == null:
		return
	_collect()
	_dispatch()
	if _busy and pending() == 0:
		_busy = false
		all_meshed.emit()


func _dispatch() -> void:
	while _in_flight < max_in_flight and not _dirty.is_empty():
		var ci: int = _dirty.keys()[0]
		_dirty.erase(ci)
		var serial := _next_serial
		_next_serial += 1
		_serial[ci] = serial
		_in_flight += 1
		var dims := Vector3i(store.size_x, store.size_y, store.size_z)
		WorkerThreadPool.add_task(_mesh_task.bind(ci, serial, store.density, dims))


func _mesh_task(ci: int, serial: int, snapshot: PackedByteArray, dims: Vector3i) -> void:
	var t0 := Time.get_ticks_usec()
	var block := Store.extract_padded(snapshot, dims.x, dims.y, dims.z, ci)
	var mesh_data := Mesher.mesh_block(block)
	var msec := float(Time.get_ticks_usec() - t0) / 1000.0
	_mutex.lock()
	_done.append({"ci": ci, "serial": serial, "mesh": mesh_data, "msec": msec})
	_mutex.unlock()


func _collect() -> void:
	_mutex.lock()
	var batch := _done
	_done = []
	_mutex.unlock()
	var swaps := 0
	var leftover: Array = []
	for r in batch:
		if swaps >= max_swaps_per_frame:
			leftover.append(r)
			continue
		_in_flight -= 1
		var ci: int = r["ci"]
		if _serial.get(ci, -1) == r["serial"] and not _dirty.has(ci):
			_swap(ci, r["mesh"])
			chunk_meshed.emit(ci, r["msec"])
			swaps += 1
	if not leftover.is_empty():
		_mutex.lock()
		_done = leftover + _done
		_mutex.unlock()


func _swap(ci: int, m: Dictionary) -> void:
	var old: MeshInstance3D = _nodes.get(ci)
	if old != null:
		old.queue_free()
		_nodes.erase(ci)
	var indices: PackedInt32Array = m["indices"]
	if indices.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = m["positions"]
	arrays[Mesh.ARRAY_NORMAL] = m["normals"]
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, material)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	var cx := ci % store.chunks_x
	var cz := (ci / store.chunks_x) % store.chunks_z
	var cy := ci / (store.chunks_x * store.chunks_z)
	node.position = Vector3(cx, cy, cz) * Store.CHUNK
	add_child(node)
	_nodes[ci] = node


func _clear() -> void:
	# Drop in-flight work: results from the old store no longer match any serial.
	_serial.clear()
	_dirty.clear()
	for node in _nodes.values():
		node.queue_free()
	_nodes.clear()
	_mutex.lock()
	_in_flight -= _done.size()
	_done.clear()
	_mutex.unlock()
	_busy = false
