## Run-length + base64 codec for voxel bytes (docs/view-protocol.md section 5).
## Pairs are [count - 1, value]; one pair covers 1 to 256 equal bytes.
extends RefCounted


## Decode a base64 RLE string. Returns an empty array (and logs an error) unless the decoded
## length is exactly `expected` bytes.
static func decode(b64: String, expected: int) -> PackedByteArray:
	var raw: PackedByteArray = Marshalls.base64_to_raw(b64)
	if raw.size() % 2 != 0:
		push_error("voxel_codec: odd number of RLE bytes")
		return PackedByteArray()
	var out := PackedByteArray()
	var total := 0
	var i := 0
	var n := raw.size()
	while i < n:
		var count: int = raw[i] + 1
		var value: int = raw[i + 1]
		total += count
		if total > expected:
			push_error("voxel_codec: more voxels than expected")
			return PackedByteArray()
		if count == 1:
			out.append(value)
		else:
			var run := PackedByteArray()
			run.resize(count)
			run.fill(value)
			out.append_array(run)
		i += 2
	if total != expected:
		push_error("voxel_codec: expected %d voxels, got %d" % [expected, total])
		return PackedByteArray()
	return out


## Encode bytes (used by tests; the server is the real encoder).
static func encode(bytes: PackedByteArray) -> String:
	var raw := PackedByteArray()
	var n := bytes.size()
	var i := 0
	while i < n:
		var value: int = bytes[i]
		var count := 1
		while i + count < n and count < 256 and bytes[i + count] == value:
			count += 1
		raw.append(count - 1)
		raw.append(value)
		i += count
	return Marshalls.raw_to_base64(raw)
