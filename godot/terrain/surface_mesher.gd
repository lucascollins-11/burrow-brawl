## Surface nets over a padded 34^3 density block. Pure and thread-safe: no scene access, so it can
## run in WorkerThreadPool. Iso level 128. Triangles are wound for Godot (clockwise front faces),
## normals point out of the solid.
extends RefCounted

const CHUNK := 32
const PAD := 1
const S := CHUNK + 2  # samples per axis
const CELLS := CHUNK + 1  # cells -1 .. CHUNK-1
const ISO := 128
## Rounds of Laplacian smoothing on the finished mesh: softens the voxel stair-steps into rounded,
## hand-shaped hills (the Storybook look). Visual only: gameplay reads the density grid.
const SMOOTH := 2
const SMOOTH_PULL := 0.6

# Corner i is at offset (i & 1, (i >> 1) & 1, (i >> 2) & 1); mask bit i is set when it is solid.
# The 12 cell edges as corner pairs (EDGE_A[i], EDGE_B[i]) are built per call inside mesh_block.
# They must not be shared constants: mesh_block runs on several worker threads at once, and
# reading a shared Array of Arrays from many threads corrupts its reference counts (this crashed
# the first Windows playtest).


## Returns { positions: PackedVector3Array, normals: PackedVector3Array,
## indices: PackedInt32Array }, positions relative to the
## chunk origin. Empty arrays when the chunk has no surface. `smooth` rounds of smoothing.
## `crisp` (optional, same padded S^3 layout as `block`): a non-zero byte marks a voxel whose
## surface must keep its hard edges, e.g. a voxel with a structure material id. Any vertex touching
## such a voxel is left where surface nets put it. This is the hook for per-material smoothing:
## hills stay soft, walls stay crisp.
static func mesh_block(block: PackedByteArray, smooth := SMOOTH, crisp := PackedByteArray()) -> Dictionary:
	var result := {
		"positions": PackedVector3Array(),
		"normals": PackedVector3Array(),
		"indices": PackedInt32Array(),
	}
	if block.size() != S * S * S:
		push_error("surface_mesher: block must be %d bytes" % (S * S * S))
		return result

	# Pass 1: which samples are solid, and how many per y layer. Skip chunks that are entirely air
	# or entirely rock, and later skip whole layers that cannot contain the surface.
	var count := S * S * S
	var layer_area := S * S
	var solid := PackedByteArray()
	solid.resize(count)
	var layer_solid := PackedInt32Array()
	layer_solid.resize(S)
	var n_solid := 0
	for y in range(S):
		var in_layer := 0
		var row := y * layer_area
		for i in range(row, row + layer_area):
			if block[i] >= ISO:
				solid[i] = 1
				in_layer += 1
		layer_solid[y] = in_layer
		n_solid += in_layer
	if n_solid == 0 or n_solid == count:
		return result

	var positions := PackedVector3Array()
	var pinned := PackedByteArray()
	var has_crisp := crisp.size() == block.size()
	var normals := PackedVector3Array()
	var cell_index := PackedInt32Array()
	cell_index.resize(CELLS * CELLS * CELLS)
	cell_index.fill(-1)
	var oy := S * S
	var oz := S
	var offs := PackedInt32Array([0, 1, oy, oy + 1, oz, oz + 1, oz + oy, oz + oy + 1])
	var edge_a := PackedInt32Array([0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3])
	var edge_b := PackedInt32Array([1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7])

	# Pass 2: one vertex per cell that straddles the surface.
	for cy in range(CELLS):
		if _uniform_pair(layer_solid, cy, layer_area):
			continue
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
				for ei in range(12):
					var ia: int = edge_a[ei]
					var ib: int = edge_b[ei]
					if ((mask >> ia) & 1) == ((mask >> ib) & 1):
						continue
					var da: float = block[b + offs[ia]]
					var db: float = block[b + offs[ib]]
					var t := (float(ISO) - da) / (db - da)
					var pa := Vector3i(ia & 1, (ia >> 1) & 1, (ia >> 2) & 1)
					var pb := Vector3i(ib & 1, (ib >> 1) & 1, (ib >> 2) & 1)
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
				var keep := cx == 0 or cy == 0 or cz == 0 or cx == CELLS - 1 or cy == CELLS - 1 or cz == CELLS - 1
				if not keep and has_crisp:
					for k in 8:
						if crisp[b + offs[k]] != 0:
							keep = true
							break
				pinned.append(1 if keep else 0)

	if positions.is_empty():
		return result

	# Pass 3: a quad for every sample edge that starts inside the chunk and changes sign.
	var indices := PackedInt32Array()
	for y in range(PAD, PAD + CHUNK):
		if _uniform_pair(layer_solid, y, layer_area):
			continue
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

	if smooth > 0 and not indices.is_empty():
		_smooth(positions, normals, indices, pinned, smooth)
	result["positions"] = positions
	result["normals"] = normals
	result["indices"] = indices
	return result


## Laplacian smoothing, then area-weighted normals. `pinned` vertices keep their place and their
## gradient normal: those of the outer cells also belong to the neighbouring chunk's mesh (so both
## chunks draw the seam identically), and the rest touch a `crisp` voxel.
static func _smooth(
	pos: PackedVector3Array, nrm: PackedVector3Array, idx: PackedInt32Array, pinned: PackedByteArray, rounds: int
) -> void:
	var n := pos.size()
	var sum := PackedVector3Array()
	var cnt := PackedInt32Array()
	sum.resize(n)
	cnt.resize(n)
	for r in rounds:
		sum.fill(Vector3.ZERO)
		cnt.fill(0)
		for t in range(0, idx.size(), 3):
			var a := idx[t]
			var b := idx[t + 1]
			var c := idx[t + 2]
			sum[a] += pos[b] + pos[c]
			sum[b] += pos[a] + pos[c]
			sum[c] += pos[a] + pos[b]
			cnt[a] += 2
			cnt[b] += 2
			cnt[c] += 2
		for i in n:
			if pinned[i] == 0 and cnt[i] > 0:
				pos[i] = pos[i].lerp(sum[i] / float(cnt[i]), SMOOTH_PULL)
	var acc := PackedVector3Array()
	acc.resize(n)
	for t in range(0, idx.size(), 3):
		var a := idx[t]
		var b := idx[t + 1]
		var c := idx[t + 2]
		var f := (pos[b] - pos[a]).cross(pos[c] - pos[a])
		acc[a] += f
		acc[b] += f
		acc[c] += f
	for i in n:
		if pinned[i] == 1:
			continue
		var v := acc[i].normalized()
		if v == Vector3.ZERO:
			continue
		# Keep the outward side the gradient chose, whatever the winding gives.
		nrm[i] = -v if v.dot(nrm[i]) < 0.0 else v


## True when sample layers y and y + 1 are both entirely air or both entirely rock, so the cells
## between them cannot hold the surface.
static func _uniform_pair(layer_solid: PackedInt32Array, y: int, layer_area: int) -> bool:
	var a := layer_solid[y]
	var b := layer_solid[y + 1]
	return a == b and (a == 0 or a == layer_area)


## Two triangles for the quad a-b-c-e. `flip` is the counter-clockwise order of the quad as seen
## from outside; Godot wants the opposite (clockwise), so the default here is the reverse.
static func _quad(indices: PackedInt32Array, a: int, b: int, c: int, e: int, flip: bool) -> void:
	if a < 0 or b < 0 or c < 0 or e < 0:
		return
	if flip:
		indices.append_array(PackedInt32Array([a, b, c, a, c, e]))
	else:
		indices.append_array(PackedInt32Array([a, c, b, a, e, c]))
