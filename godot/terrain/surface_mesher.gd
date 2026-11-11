## Surface nets over a padded 34^3 density block. Pure and thread-safe: no scene access, so it can
## run in WorkerThreadPool. Iso level 128. Triangles are wound for Godot (clockwise front faces),
## normals point out of the solid.
extends RefCounted

const CHUNK := 32
const PAD := 1
const S := CHUNK + 2  # samples per axis
const CELLS := CHUNK + 1  # cells -1 .. CHUNK-1
const ISO := 128

# Corner i is at offset (i & 1, (i >> 1) & 1, (i >> 2) & 1); mask bit i is set when it is solid.
const CORNER := [
	Vector3i(0, 0, 0),
	Vector3i(1, 0, 0),
	Vector3i(0, 1, 0),
	Vector3i(1, 1, 0),
	Vector3i(0, 0, 1),
	Vector3i(1, 0, 1),
	Vector3i(0, 1, 1),
	Vector3i(1, 1, 1),
]
const EDGES := [
	[0, 1],
	[2, 3],
	[4, 5],
	[6, 7],
	[0, 2],
	[1, 3],
	[4, 6],
	[5, 7],
	[0, 4],
	[1, 5],
	[2, 6],
	[3, 7],
]


## Returns { positions: PackedVector3Array, normals: PackedVector3Array,
## indices: PackedInt32Array }, positions relative to the
## chunk origin. Empty arrays when the chunk has no surface.
static func mesh_block(block: PackedByteArray) -> Dictionary:
	var result := {
		"positions": PackedVector3Array(),
		"normals": PackedVector3Array(),
		"indices": PackedInt32Array(),
	}
	if block.size() != S * S * S:
		push_error("surface_mesher: block must be %d bytes" % (S * S * S))
		return result

	# Pass 1: which samples are solid; skip chunks that are entirely air or entirely rock.
	var count := S * S * S
	var solid := PackedByteArray()
	solid.resize(count)
	var n_solid := 0
	for i in range(count):
		if block[i] >= ISO:
			solid[i] = 1
			n_solid += 1
	if n_solid == 0 or n_solid == count:
		return result

	var positions := PackedVector3Array()
	var normals := PackedVector3Array()
	var cell_index := PackedInt32Array()
	cell_index.resize(CELLS * CELLS * CELLS)
	cell_index.fill(-1)
	var oy := S * S
	var oz := S
	var offs := PackedInt32Array([0, 1, oy, oy + 1, oz, oz + 1, oz + oy, oz + oy + 1])

	# Pass 2: one vertex per cell that straddles the surface.
	for cy in range(CELLS):
		for cz in range(CELLS):
			var base := (cy * S + cz) * S
			for cx in range(CELLS):
				var b := base + cx
				var mask := (
					solid[b]
					| (solid[b + 1] << 1)
					| (solid[b + oy] << 2)
					| (solid[b + oy + 1] << 3)
					| (solid[b + oz] << 4)
					| (solid[b + oz + 1] << 5)
					| (solid[b + oz + oy] << 6)
					| (solid[b + oz + oy + 1] << 7)
				)
				if mask == 0 or mask == 255:
					continue
				var sum := Vector3.ZERO
				var n := 0
				for e in EDGES:
					var ia: int = e[0]
					var ib: int = e[1]
					if ((mask >> ia) & 1) == ((mask >> ib) & 1):
						continue
					var da: float = block[b + offs[ia]]
					var db: float = block[b + offs[ib]]
					var t := (float(ISO) - da) / (db - da)
					var pa: Vector3i = CORNER[ia]
					var pb: Vector3i = CORNER[ib]
					sum += Vector3(pa) + Vector3(pb - pa) * t
					n += 1
				var d0 := float(block[b])
				var d1 := float(block[b + 1])
				var d2 := float(block[b + oy])
				var d3 := float(block[b + oy + 1])
				var d4 := float(block[b + oz])
				var d5 := float(block[b + oz + 1])
				var d6 := float(block[b + oz + oy])
				var d7 := float(block[b + oz + oy + 1])
				var grad := Vector3(
					d1 + d3 + d5 + d7 - (d0 + d2 + d4 + d6),
					d2 + d3 + d6 + d7 - (d0 + d1 + d4 + d5),
					d4 + d5 + d6 + d7 - (d0 + d1 + d2 + d3)
				)
				var nrm := -grad.normalized() if grad.length_squared() > 0.0 else Vector3.UP
				cell_index[(cy * CELLS + cz) * CELLS + cx] = positions.size()
				positions.append(sum / float(n) + Vector3(cx - PAD, cy - PAD, cz - PAD))
				normals.append(nrm)

	if positions.is_empty():
		return result

	# Pass 3: a quad for every sample edge that starts inside the chunk and changes sign.
	var indices := PackedInt32Array()
	for y in range(PAD, PAD + CHUNK):
		for z in range(PAD, PAD + CHUNK):
			var base2 := (y * S + z) * S
			for x in range(PAD, PAD + CHUNK):
				var i := base2 + x
				var here: int = solid[i]
				if solid[i + 1] != here:
					_quad(
						indices,
						cell_index[(y - 1) * CELLS * CELLS + (z - 1) * CELLS + x],
						cell_index[y * CELLS * CELLS + (z - 1) * CELLS + x],
						cell_index[y * CELLS * CELLS + z * CELLS + x],
						cell_index[(y - 1) * CELLS * CELLS + z * CELLS + x],
						here == 0
					)
				if solid[i + oy] != here:
					_quad(
						indices,
						cell_index[y * CELLS * CELLS + (z - 1) * CELLS + x - 1],
						cell_index[y * CELLS * CELLS + (z - 1) * CELLS + x],
						cell_index[y * CELLS * CELLS + z * CELLS + x],
						cell_index[y * CELLS * CELLS + z * CELLS + x - 1],
						here == 1
					)
				if solid[i + oz] != here:
					_quad(
						indices,
						cell_index[(y - 1) * CELLS * CELLS + z * CELLS + x - 1],
						cell_index[(y - 1) * CELLS * CELLS + z * CELLS + x],
						cell_index[y * CELLS * CELLS + z * CELLS + x],
						cell_index[y * CELLS * CELLS + z * CELLS + x - 1],
						here == 0
					)

	result["positions"] = positions
	result["normals"] = normals
	result["indices"] = indices
	return result


## Two triangles for the quad a-b-c-e. `flip` is the counter-clockwise order of the quad as seen
## from outside; Godot wants the opposite (clockwise), so the default here is the reverse.
static func _quad(indices: PackedInt32Array, a: int, b: int, c: int, e: int, flip: bool) -> void:
	if a < 0 or b < 0 or c < 0 or e < 0:
		return
	if flip:
		indices.append_array(PackedInt32Array([a, b, c, a, c, e]))
	else:
		indices.append_array(PackedInt32Array([a, c, b, a, e, c]))
