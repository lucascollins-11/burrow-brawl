## The client's copy of the voxel grid. Filled from `match.start`, edited only by `terrain.patch`.
## One flat byte array, index (y * size_z + z) * size_x + x. Solid is density >= 128.
## Chunks (32^3) exist only for versions and meshing.
extends RefCounted

const Codec := preload("res://terrain/voxel_codec.gd")

const CHUNK := 32
const PADDED := CHUNK + 2
const SOLID := 128

var size_x := 0
var size_y := 0
var size_z := 0
var sea_y := 0
var bedrock_y := 0
var chunks_x := 0
var chunks_y := 0
var chunks_z := 0
var density := PackedByteArray()
## Bumped when any voxel of the chunk changes.
var chunk_version := PackedInt32Array()


## Load from the `terrain` object of match.start. Returns false (store left empty) if invalid.
func load_full(t: Dictionary) -> bool:
	var sx := int(t.get("sizeX", 0))
	var sy := int(t.get("sizeY", 0))
	var sz := int(t.get("sizeZ", 0))
	if sx <= 0 or sy <= 0 or sz <= 0 or sx % CHUNK != 0 or sy % CHUNK != 0 or sz % CHUNK != 0:
		push_error("voxel_store: bad terrain size %d x %d x %d" % [sx, sy, sz])
		return false
	var bytes := Codec.decode(str(t.get("density", "")), sx * sy * sz)
	if bytes.is_empty():
		return false
	size_x = sx
	size_y = sy
	size_z = sz
	sea_y = int(t.get("seaY", 0))
	bedrock_y = int(t.get("bedrockY", 0))
	chunks_x = sx / CHUNK
	chunks_y = sy / CHUNK
	chunks_z = sz / CHUNK
	density = bytes
	chunk_version = PackedInt32Array()
	chunk_version.resize(chunks_x * chunks_y * chunks_z)
	return true


func chunk_count() -> int:
	return chunks_x * chunks_y * chunks_z


func chunk_index(cx: int, cy: int, cz: int) -> int:
	return (cy * chunks_z + cz) * chunks_x + cx


func in_grid(x: int, y: int, z: int) -> bool:
	return x >= 0 and y >= 0 and z >= 0 and x < size_x and y < size_y and z < size_z


## Below y = 0 is solid, every other out-of-range voxel is air.
func density_at(x: int, y: int, z: int) -> int:
	if in_grid(x, y, z):
		return density[(y * size_z + z) * size_x + x]
	return 255 if y < 0 else 0


func is_solid(x: int, y: int, z: int) -> bool:
	return density_at(x, y, z) >= SOLID


## Height of the highest surface in the column (ix, iz), in voxel units, where the density
## crosses 128 between sample points; -1.0 if the column is empty or outside the grid.
func column_height(ix: int, iz: int) -> float:
	if ix < 0 or iz < 0 or ix >= size_x or iz >= size_z:
		return -1.0
	for y in range(size_y - 1, -1, -1):
		var d0: int = density[(y * size_z + iz) * size_x + ix]
		if d0 < SOLID:
			continue
		var d1 := 0 if y + 1 >= size_y else int(density[((y + 1) * size_z + iz) * size_x + ix])
		return float(y) + float(d0 - SOLID) / float(maxi(1, d0 - d1))
	return -1.0


## Surface height at a world position (bilinear over the four nearest columns). Columns with no
## ground are skipped; returns 0.0 when none of them has any.
func ground_height(x: float, z: float) -> float:
	var ix := floori(x)
	var iz := floori(z)
	var fx := x - float(ix)
	var fz := z - float(iz)
	var total := 0.0
	var weight := 0.0
	for k in range(4):
		var cx := ix + (k & 1)
		var cz := iz + (k >> 1)
		var h := column_height(cx, cz)
		if h < 0.0:
			continue
		var w := (fx if (k & 1) == 1 else 1.0 - fx) * (fz if (k >> 1) == 1 else 1.0 - fz)
		total += h * w
		weight += w
	return total / weight if weight > 0.0 else 0.0


## Apply a `terrain.patch` message. Returns the chunk indices that need a remesh: every chunk the
## box touches plus its neighbours (a chunk mesh reads a 1-voxel border). Empty on a bad patch.
func apply_patch(msg: Dictionary) -> PackedInt32Array:
	var x0 := int(msg.get("x0", 0))
	var y0 := int(msg.get("y0", 0))
	var z0 := int(msg.get("z0", 0))
	var sx := int(msg.get("sx", 0))
	var sy := int(msg.get("sy", 0))
	var sz := int(msg.get("sz", 0))
	var result := PackedInt32Array()
	if sx <= 0 or sy <= 0 or sz <= 0:
		return result
	if x0 < 0 or y0 < 0 or z0 < 0 or x0 + sx > size_x or y0 + sy > size_y or z0 + sz > size_z:
		push_error("voxel_store: patch outside the grid")
		return result
	var bytes := Codec.decode(str(msg.get("density", "")), sx * sy * sz)
	if bytes.is_empty():
		return result
	var touched := {}
	var k := 0
	for y in range(y0, y0 + sy):
		for z in range(z0, z0 + sz):
			var row := (y * size_z + z) * size_x + x0
			var cy := y / CHUNK
			var cz := z / CHUNK
			for x in range(sx):
				var v: int = bytes[k]
				k += 1
				if density[row + x] != v:
					density[row + x] = v
					touched[chunk_index((x0 + x) / CHUNK, cy, cz)] = true
	for ci in touched:
		chunk_version[ci] += 1
	# Remesh set: the box's chunks and all their neighbours.
	var lo_x := maxi(0, (x0 - 1) / CHUNK)
	var hi_x := mini(chunks_x - 1, (x0 + sx) / CHUNK)
	var lo_y := maxi(0, (y0 - 1) / CHUNK)
	var hi_y := mini(chunks_y - 1, (y0 + sy) / CHUNK)
	var lo_z := maxi(0, (z0 - 1) / CHUNK)
	var hi_z := mini(chunks_z - 1, (z0 + sz) / CHUNK)
	for cy in range(lo_y, hi_y + 1):
		for cz in range(lo_z, hi_z + 1):
			for cx in range(lo_x, hi_x + 1):
				result.append(chunk_index(cx, cy, cz))
	return result


## Copy chunk `ci` plus a 1-voxel border: PADDED^3 bytes, layout (y * PADDED + z) * PADDED + x.
func copy_chunk_padded(ci: int) -> PackedByteArray:
	var cx := ci % chunks_x
	var cz := (ci / chunks_x) % chunks_z
	var cy := ci / (chunks_x * chunks_z)
	var ox := cx * CHUNK - 1
	var oy := cy * CHUNK - 1
	var oz := cz * CHUNK - 1
	var out := PackedByteArray()
	var row_in_x := ox >= 0 and ox + PADDED <= size_x
	for y in range(PADDED):
		var wy := oy + y
		for z in range(PADDED):
			var wz := oz + z
			if wy < 0 or wy >= size_y or wz < 0 or wz >= size_z:
				var fill := PackedByteArray()
				fill.resize(PADDED)
				fill.fill(255 if wy < 0 else 0)
				out.append_array(fill)
			elif row_in_x:
				var src := (wy * size_z + wz) * size_x + ox
				out.append_array(density.slice(src, src + PADDED))
			else:
				for x in range(PADDED):
					out.append(density_at(ox + x, wy, wz))
	return out
