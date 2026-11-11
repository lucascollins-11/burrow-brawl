## Headless tests for godot/terrain. Run:
##   godot --headless --path godot --script res://tests/terrain_tests.gd
## Exits non-zero on any failure. Prints BENCH lines with meshing times in ms.
extends SceneTree

const Codec := preload("res://terrain/voxel_codec.gd")
const Store := preload("res://terrain/voxel_store.gd")
const Mesher := preload("res://terrain/surface_mesher.gd")
const View := preload("res://terrain/terrain_view.gd")

var failures := 0
var checks := 0
var _seed := 12345


func _init() -> void:
	test_codec()
	test_store_rules()
	test_padded_copy()
	test_patch()
	test_ground_height()
	test_mesher_empty_and_full()
	test_mesher_sphere()
	test_mesher_seams()
	bench()
	print("terrain tests: %d checks, %d failures" % [checks, failures])
	quit(1 if failures > 0 else 0)


func check(cond: bool, msg: String) -> void:
	checks += 1
	if not cond:
		failures += 1
		printerr("FAIL: " + msg)


func rnd(n: int) -> int:
	_seed = (_seed * 1664525 + 1013904223) & 0xFFFFFFFF
	return (_seed >> 8) % n


# ---------- helpers ----------


func sphere_density(x: float, y: float, z: float, c: Vector3, r: float) -> int:
	var d := Vector3(x, y, z).distance_to(c)
	return clampi(int(round(128.0 + (r - d) * 64.0)), 0, 255)


func sphere_block(c: Vector3, r: float) -> PackedByteArray:
	var s := Mesher.S
	var b := PackedByteArray()
	b.resize(s * s * s)
	for y in range(s):
		for z in range(s):
			for x in range(s):
				b[(y * s + z) * s + x] = sphere_density(x, y, z, c, r)
	return b


func make_store(sx: int, sy: int, sz: int, fn: Callable) -> Store:
	var bytes := PackedByteArray()
	bytes.resize(sx * sy * sz)
	for y in range(sy):
		for z in range(sz):
			for x in range(sx):
				bytes[(y * sz + z) * sx + x] = fn.call(x, y, z)
	var st := Store.new()
	var ok := (
		st
		. load_full(
			{
				"sizeX": sx,
				"sizeY": sy,
				"sizeZ": sz,
				"seaY": 10,
				"bedrockY": 3,
				"density": Codec.encode(bytes),
			}
		)
	)
	check(ok, "store loads")
	return st


func weld_key(v: Vector3) -> String:
	return "%d,%d,%d" % [roundi(v.x * 1000.0), roundi(v.y * 1000.0), roundi(v.z * 1000.0)]


# ---------- tests ----------


func test_codec() -> void:
	var known := Codec.decode("AgUAyA==", 4)
	check(known == PackedByteArray([5, 5, 5, 200]), "known vector decodes")
	check(Codec.encode(PackedByteArray([5, 5, 5, 200])) == "AgUAyA==", "known vector encodes")
	var bytes := PackedByteArray()
	for i in range(20):
		var value := rnd(256)
		var run := 1 + rnd(700) if i % 3 == 0 else 1 + rnd(5)
		for k in range(run):
			bytes.append(value)
	var back := Codec.decode(Codec.encode(bytes), bytes.size())
	check(back == bytes, "codec round trip with runs over 256")
	check(Codec.decode("AgUAyA==", 5).is_empty(), "wrong expected length is rejected")
	check(Codec.decode("AgUA", 3).is_empty(), "odd RLE byte count is rejected")


func test_store_rules() -> void:
	var st := make_store(
		64, 64, 64, func(_x: int, y: int, _z: int) -> int: return 255 if y < 20 else 0
	)
	check(st.is_solid(5, -1, 5), "below the grid is solid")
	check(not st.is_solid(-1, 5, 5), "beside the grid is air")
	check(not st.is_solid(5, 70, 5), "above the grid is air")
	check(st.is_solid(5, 19, 5) and not st.is_solid(5, 20, 5), "grid contents")
	check(st.chunk_count() == 8, "2x2x2 chunks")
	var bad := Store.new()
	check(
		not bad.load_full({"sizeX": 33, "sizeY": 32, "sizeZ": 32, "density": ""}),
		"rejects odd size"
	)


func test_padded_copy() -> void:
	var st := make_store(
		96, 64, 96, func(x: int, y: int, z: int) -> int: return (x * 7 + y * 13 + z * 29) % 256
	)
	var bad := 0
	var s := Mesher.S
	for ci in [0, 1, 5, st.chunk_count() - 1]:
		var block := st.copy_chunk_padded(ci)
		check(block.size() == s * s * s, "padded block size")
		var cx: int = ci % st.chunks_x
		var cz: int = (ci / st.chunks_x) % st.chunks_z
		var cy: int = ci / (st.chunks_x * st.chunks_z)
		for y in range(s):
			for z in range(s):
				for x in range(s):
					var want := st.density_at(cx * 32 + x - 1, cy * 32 + y - 1, cz * 32 + z - 1)
					if block[(y * s + z) * s + x] != want:
						bad += 1
	check(bad == 0, "padded copy matches density_at (%d bad)" % bad)


func test_patch() -> void:
	var st := make_store(
		96, 64, 96, func(_x: int, y: int, _z: int) -> int: return 255 if y < 20 else 0
	)
	var box := PackedByteArray()
	box.resize(4 * 4 * 4)
	box.fill(0)
	var msg := {
		"x0": 30, "y0": 10, "z0": 8, "sx": 4, "sy": 4, "sz": 4, "density": Codec.encode(box)
	}
	var touched := st.apply_patch(msg)
	check(not st.is_solid(31, 11, 9), "patch cleared voxels")
	check(st.is_solid(29, 11, 9) and st.is_solid(34, 11, 9), "voxels outside the box untouched")
	check(
		touched.size() == 2 and touched.has(0) and touched.has(1),
		"box on a chunk border remeshes both chunks"
	)
	check(st.chunk_version[0] == 1 and st.chunk_version[1] == 1, "touched chunk versions bumped")
	check(st.chunk_version[2] == 0, "other chunks untouched")
	var interior := {
		"x0": 8,
		"y0": 8,
		"z0": 8,
		"sx": 2,
		"sy": 2,
		"sz": 2,
		"density": Codec.encode(PackedByteArray([0, 0, 0, 0, 0, 0, 0, 0]))
	}
	check(st.apply_patch(interior).size() == 1, "interior box remeshes one chunk")
	var outside := {
		"x0": 90,
		"y0": 0,
		"z0": 0,
		"sx": 10,
		"sy": 1,
		"sz": 1,
		"density": Codec.encode(PackedByteArray([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]))
	}
	check(st.apply_patch(outside).is_empty(), "patch outside the grid is rejected")


func test_ground_height() -> void:
	var flat := func(_x: int, y: int, _z: int) -> int: return 255 if y < 20 else 0
	var st := make_store(64, 64, 64, flat)
	check(absf(st.column_height(10, 10) - 19.498) < 0.01, "column height at the density crossing")
	check(st.column_height(-1, 5) < 0.0, "outside the grid has no column")
	check(absf(st.ground_height(10.5, 20.25) - 19.498) < 0.01, "ground height on flat ground")
	# A slope: height rises 1 voxel per x.
	var slope := make_store(
		64, 64, 64, func(x: int, y: int, _z: int) -> int: return 255 if y < x else 0
	)
	check(
		absf(slope.ground_height(20.5, 5.0) - slope.ground_height(20.0, 5.0) - 0.5) < 0.01,
		"interpolates"
	)
	var view := View.new()
	var bytes := PackedByteArray()
	bytes.resize(32 * 32 * 32)
	for i in range(bytes.size()):
		bytes[i] = 255 if i < 32 * 32 * 8 else 0
	var ok: bool = view.load_terrain(
		{
			"sizeX": 32,
			"sizeY": 32,
			"sizeZ": 32,
			"seaY": 5,
			"bedrockY": 1,
			"density": Codec.encode(bytes)
		}
	)
	check(ok, "load_terrain accepts a match.start terrain")
	check(absf(view.ground_y(10.0, 10.0) - 7.498) < 0.01, "ground_y from the view")
	check(not view.load_terrain({"sizeX": 5}), "load_terrain rejects a bad terrain")
	view.free()


func test_mesher_empty_and_full() -> void:
	var s := Mesher.S
	var air := PackedByteArray()
	air.resize(s * s * s)
	check(Mesher.mesh_block(air)["indices"].is_empty(), "air block has no mesh")
	air.fill(255)
	check(Mesher.mesh_block(air)["indices"].is_empty(), "rock block has no mesh")


func test_mesher_sphere() -> void:
	var c := Vector3(17.0, 17.0, 17.0)  # chunk coords + 1 for the border
	var m := Mesher.mesh_block(sphere_block(c, 9.3))
	var pos: PackedVector3Array = m["positions"]
	var nor: PackedVector3Array = m["normals"]
	var idx: PackedInt32Array = m["indices"]
	check(idx.size() > 300, "sphere has a surface")
	check(idx.size() % 3 == 0, "whole triangles")
	var center := c - Vector3(1, 1, 1)  # positions are relative to the chunk origin
	var cw := 0
	var directed := {}
	for i in range(0, idx.size(), 3):
		var a := pos[idx[i]]
		var b := pos[idx[i + 1]]
		var d := pos[idx[i + 2]]
		# Godot front faces are clockwise: the geometric normal points inward.
		if (b - a).cross(d - a).dot(a - center) < 0.0:
			cw += 1
		for e in [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]:
			var k := "%d>%d" % [e[0], e[1]]
			directed[k] = directed.get(k, 0) + 1
	check(
		cw == idx.size() / 3,
		"every triangle is clockwise seen from outside (%d of %d)" % [cw, idx.size() / 3]
	)
	var manifold := true
	for k in directed:
		var parts: PackedStringArray = k.split(">")
		if directed[k] != 1 or directed.get("%s>%s" % [parts[1], parts[0]], 0) != 1:
			manifold = false
	check(manifold, "sphere surface is closed")
	var outward := true
	for v in range(pos.size()):
		if nor[v].dot(pos[v] - center) <= 0.0:
			outward = false
	check(outward, "vertex normals point out of the solid")


func test_mesher_seams() -> void:
	var c := Vector3(31.6, 32.3, 32.7)
	var st := make_store(
		64, 64, 64, func(x: int, y: int, z: int) -> int: return sphere_density(x, y, z, c, 14.0)
	)
	var edges := {}
	var chunks_with_mesh := 0
	for ci in range(st.chunk_count()):
		var m := Mesher.mesh_block(st.copy_chunk_padded(ci))
		var idx: PackedInt32Array = m["indices"]
		if idx.is_empty():
			continue
		chunks_with_mesh += 1
		var pos: PackedVector3Array = m["positions"]
		var origin := Vector3(ci % 2, ci / 4, (ci / 2) % 2) * 32.0
		for i in range(0, idx.size(), 3):
			var k0 := weld_key(pos[idx[i]] + origin)
			var k1 := weld_key(pos[idx[i + 1]] + origin)
			var k2 := weld_key(pos[idx[i + 2]] + origin)
			for pair in [[k0, k1], [k1, k2], [k2, k0]]:
				var key: String = (
					pair[0] + "|" + pair[1] if pair[0] < pair[1] else pair[1] + "|" + pair[0]
				)
				edges[key] = edges.get(key, 0) + 1
	var cracks := 0
	for k in edges:
		if edges[k] == 1:
			cracks += 1
	check(chunks_with_mesh == 8, "sphere straddling all chunk corners meshes 8 chunks")
	check(cracks == 0, "no cracks across chunk borders (%d open edges)" % cracks)


func bench() -> void:
	# One chunk full of sphere surface.
	var block := sphere_block(Vector3(17, 17, 17), 13.0)
	Mesher.mesh_block(block)
	var t0 := Time.get_ticks_usec()
	for i in range(10):
		Mesher.mesh_block(block)
	var sphere_ms := float(Time.get_ticks_usec() - t0) / 1000.0 / 10.0
	print("BENCH sphere_chunk_mesh_ms=%.2f" % sphere_ms)
	# A hilly 96^3 world: mesh every chunk, report surface chunks separately.
	var st := make_store(
		96,
		96,
		96,
		func(x: int, y: int, z: int) -> int:
			var top := 30.0 + 10.0 * sin(x * 0.11) + 8.0 * cos(z * 0.13)
			return clampi(int(128.0 + (top - y) * 64.0), 0, 255)
	)
	var total_ms := 0.0
	var surface_chunks := 0
	var surface_ms := 0.0
	var copy_ms := 0.0
	for ci in range(st.chunk_count()):
		var c0 := Time.get_ticks_usec()
		var blk := st.copy_chunk_padded(ci)
		copy_ms += float(Time.get_ticks_usec() - c0) / 1000.0
		var m0 := Time.get_ticks_usec()
		var m := Mesher.mesh_block(blk)
		var ms := float(Time.get_ticks_usec() - m0) / 1000.0
		total_ms += ms
		if not m["indices"].is_empty():
			surface_chunks += 1
			surface_ms += ms
	var avg := surface_ms / maxf(1.0, float(surface_chunks))
	print(
		(
			(
				"BENCH hills_chunks=%d surface_chunks=%d total_mesh_ms=%.1f "
				+ "avg_surface_chunk_ms=%.2f copy_chunk_avg_ms=%.2f"
			)
			% [st.chunk_count(), surface_chunks, total_ms, avg, copy_ms / float(st.chunk_count())]
		)
	)
	check(surface_chunks > 0, "hills have surface chunks")
	# Loose guard only; the number above is what matters.
	check(avg < 1000.0, "surface chunk meshing is not absurdly slow (%.1f ms)" % avg)
