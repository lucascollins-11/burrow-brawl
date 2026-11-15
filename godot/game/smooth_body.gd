class_name SmoothBody
extends RefCounted
## The Squirmling's smooth, seamless body: one tube swept along the same S-curve spine as the five
## ring nodes, with a tail that tapers to a soft point, a slim neck and a rounded head end that
## grows out of the neck. The mesh is built once per team colour (at rest) and skinned to five
## bones that the rig drives from its ring nodes, so every ring animation (slither, stretch,
## squash, lean, head turn) bends the body on the GPU. The ring spheres are kept, hidden, for the
## knock-out pop.

const CREAM := Color("f3e3c3")
const TAIL_TIP_LEN := 0.5
const STEPS := 72
const SEGS := 28
## Tube radius at ring centres 0 to 3 (the head is wider, see `_knots`).
const PROFILE := [0.30, 0.45, 0.57, 0.62]
const SHADER := """
shader_type spatial;
render_mode diffuse_toon, specular_toon;
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec3 flash_color : source_color = vec3(1.0, 0.93, 0.85);
void fragment() {
	vec3 base = mix(COLOR.rgb, flash_color, flash);
	ALBEDO = base;
	ROUGHNESS = 0.55;
	RIM = 0.3;
	RIM_TINT = 0.6;
	EMISSION = flash_color * flash * 0.35;
}
"""

static var _meshes: Dictionary = {}
static var _shader: Shader


## A fresh material (each Squirmling flashes on its own).
static func make_material() -> ShaderMaterial:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER
	var m := ShaderMaterial.new()
	m.shader = _shader
	return m


## The skinned body for one Squirmling: a Skeleton3D with five bones (one per ring, at the ring's
## rest pose) and the tube as its child. Returns the skeleton; its child is named "Skin".
static func make_skeleton(team: Color, material: ShaderMaterial) -> Skeleton3D:
	var sk := Skeleton3D.new()
	sk.name = "BodySkeleton"
	for i in range(Squirmling.RING_COUNT):
		sk.add_bone("ring%d" % i)
		sk.set_bone_rest(i, Transform3D(Basis(Vector3.RIGHT, Squirmling.curl_angle(i)), Squirmling.curl_base(i)))
		sk.reset_bone_pose(i)
	var mi := MeshInstance3D.new()
	mi.name = "Skin"
	mi.mesh = body_mesh(team)
	mi.material_override = material
	sk.add_child(mi)
	mi.skin = sk.create_skin_from_rest_transforms()
	mi.skeleton = NodePath("..")
	return sk


## The cached tube mesh in the team colour.
static func body_mesh(team: Color) -> ArrayMesh:
	var key := team.to_html()
	if not _meshes.has(key):
		_meshes[key] = _build(team)
	return _meshes[key]


## Spine knots: position, radius and the bone that carries each.
static func _knots() -> Array:
	var n := Squirmling.RING_COUNT
	var base: Array[Vector3] = []
	for i in range(n):
		base.append(Squirmling.curl_base(i))
	var k: Array = []
	var tail_dir := (base[0] - base[1]).normalized()
	k.append([base[0] + tail_dir * TAIL_TIP_LEN, 0.05, 0])
	k.append([base[0] + tail_dir * TAIL_TIP_LEN * 0.5, 0.13, 0])
	for i in range(4):
		k.append([base[i], PROFILE[i], i])
	# Head: the spine carries on past the head centre, swelling to the head's width and closing in a
	# rounded cap, so the head is part of the same surface as the neck.
	var up := (base[n - 1] - base[n - 2]).normalized()
	k.append([base[n - 1], 0.92, 4])
	k.append([base[n - 1] + up * 0.28, 0.86, 4])
	k.append([base[n - 1] + up * 0.52, 0.58, 4])
	k.append([base[n - 1] + up * 0.64, 0.2, 4])
	k.append([base[n - 1] + up * 0.68, 0.0, 4])
	return k


static func _build(team: Color) -> ArrayMesh:
	var knots := _knots()
	var n := knots.size()
	var spine: Array[Vector3] = []
	var rad: Array[float] = []
	var bones: Array = []  # per sample: [bone_a, bone_b, weight_b]
	for k in range(STEPS + 1):
		var t := float(k) / float(STEPS) * float(n - 1)
		var i := mini(int(t), n - 2)
		var u := t - float(i)
		var p0: Vector3 = knots[maxi(i - 1, 0)][0]
		var p1: Vector3 = knots[i][0]
		var p2: Vector3 = knots[i + 1][0]
		var p3: Vector3 = knots[mini(i + 2, n - 1)][0]
		spine.append(p1.cubic_interpolate(p2, p0, p3, u))
		rad.append(
			maxf(
				0.0,
				_cubic(
					float(knots[maxi(i - 1, 0)][1]),
					float(knots[i][1]),
					float(knots[i + 1][1]),
					float(knots[mini(i + 2, n - 1)][1]),
					u
				)
			)
		)
		var bu := u
		if int(knots[i][2]) == 3 and int(knots[i + 1][2]) == 4:
			bu = clampf(u * 1.8, 0.0, 1.0)  # the head follows its own bone early, so the face stays on it
		bones.append([int(knots[i][2]), int(knots[i + 1][2]), bu])
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0)
	var frame_side := Vector3.RIGHT
	for k in range(STEPS + 1):
		var tan_v := (spine[mini(k + 1, STEPS)] - spine[maxi(k - 1, 0)]).normalized()
		if k == 0:
			frame_side = tan_v.cross(Vector3.RIGHT).normalized()
		else:
			frame_side = (frame_side - tan_v * frame_side.dot(tan_v)).normalized()
		var side := frame_side
		var up := side.cross(tan_v).normalized()
		var b: Array = bones[k]
		var bone_ids := PackedInt32Array([int(b[0]), int(b[1]), 0, 0])
		var wb := float(b[2]) if int(b[0]) != int(b[1]) else 0.0
		var weights := PackedFloat32Array([1.0 - wb, wb, 0.0, 0.0])
		for j in range(SEGS):
			var a := TAU * float(j) / float(SEGS)
			var dir := side * cos(a) + up * sin(a)
			st.set_color(_tint(team, dir, float(k) / float(STEPS)).srgb_to_linear())
			st.set_bones(bone_ids)
			st.set_weights(weights)
			st.add_vertex(spine[k] + dir * rad[k])
	for k in range(STEPS):
		for j in range(SEGS):
			var j2 := (j + 1) % SEGS
			var a := k * SEGS + j
			var b2 := k * SEGS + j2
			var c := (k + 1) * SEGS + j2
			var d := (k + 1) * SEGS + j
			for idx in [a, b2, c, a, c, d]:
				st.add_index(idx)
	st.generate_normals()
	return st.commit()


static func _cubic(p0: float, p1: float, p2: float, p3: float, u: float) -> float:
	# Catmull-Rom for a scalar, same weights as Vector3.cubic_interpolate with unit tangents.
	var u2 := u * u
	var u3 := u2 * u
	return 0.5 * (2.0 * p1 + (p2 - p0) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * u3)


## Team colour on top and sides, a faint cream belly, and two thin soft cream bands that wrap the
## body (so they bend with it).
static func _tint(team: Color, dir: Vector3, t: float) -> Color:
	var x := clampf((-0.55 - dir.y) / 0.4, 0.0, 1.0)
	var belly := x * x * (3.0 - 2.0 * x) * 0.75
	var band := 0.0
	for centre in [0.36, 0.50]:
		var w := 1.0 - clampf((absf(t - centre) - 0.012) / 0.014, 0.0, 1.0)
		band = maxf(band, w * w * (3.0 - 2.0 * w))
	return team.lerp(CREAM, maxf(belly, band * 0.95))


static var _head_tris := PackedVector3Array()


## The head's rest-pose triangles in the head ring's local frame (cached), so the face can be
## placed on the real surface instead of on a guessed sphere.
static func _head_faces() -> PackedVector3Array:
	if _head_tris.is_empty():
		var h := Squirmling.RING_COUNT - 1
		var to_local := Transform3D(Basis(Vector3.RIGHT, Squirmling.curl_angle(h)), Squirmling.curl_base(h)).affine_inverse()
		for v in body_mesh(Color.WHITE).get_faces():
			_head_tris.append(to_local * v)
	return _head_tris


## Where a ray along head-local -z, started in front of the head at (x, y), meets the skin.
static func _hit(x: float, y: float) -> Vector3:
	var tris := _head_faces()
	var from := Vector3(x, y, 4.0)
	var best := -INF
	for i in range(0, tris.size(), 3):
		var h = Geometry3D.ray_intersects_triangle(from, Vector3(0, 0, -1), tris[i], tris[i + 1], tris[i + 2])
		if h != null and (h as Vector3).z > best:
			best = (h as Vector3).z
	return Vector3(x, y, best if best > -INF else 0.8)


## Surface point and outward normal at (x, y) on the front of the head.
static func surface(x: float, y: float) -> Array:
	var p := _hit(x, y)
	var e := 0.04
	var dx := _hit(x + e, y) - _hit(x - e, y)
	var dy := _hit(x, y + e) - _hit(x, y - e)
	var n := dx.cross(dy).normalized()
	if n.z < 0.0:
		n = -n
	return [p, n]


static func _orient(n: Vector3) -> Basis:
	var up := Vector3.UP if absf(n.y) < 0.95 else Vector3.RIGHT
	var x := up.cross(n).normalized()
	return Basis(x, n.cross(x).normalized(), n)


static func _blob(r: Vector3, color: Color, pos: Vector3, rough := 0.3) -> MeshInstance3D:
	var mi := Squirmling._part(Squirmling._sphere(1.0), color, pos, rough)
	mi.scale = r
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


## A line of soft beads laid on the skin through head-local (x, y) points: a clean stitched curve.
static func _bead_line(parent: Node3D, pts: Array, r: float) -> void:
	for p in pts:
		var s := surface(p.x, p.y)
		parent.add_child(_blob(Vector3(r, r, r), Squirmling.BEAD, (s[0] as Vector3) + (s[1] as Vector3) * (r * 0.9), 0.5))


static func _arc(w: float, y: float, bend: float, n := 9) -> Array:
	var pts := []
	for k in range(n):
		var u := float(k) / float(n - 1) * 2.0 - 1.0
		pts.append(Vector2(u * w, y + bend * u * u))
	return pts


## The face, fitted to the head: two very big round white eyes that overlap in the middle and sit
## high on the head, simple round black pupils, felt brows above and a clean one-line mouth, all
## following the curve of the skin. Call on the head ring (after `Squirmling._face`) before bind.
static func fit_face(head: Node3D, _team: Color) -> void:
	for side in ["L", "R"]:
		var sx := -1.0 if side == "L" else 1.0
		var eye := head.get_node("Eye" + side) as Node3D
		for c in eye.get_children():
			c.queue_free()
		var s := surface(sx * 0.33, 0.22)
		eye.position = s[0]
		var o := Node3D.new()
		o.name = "Orient"
		o.basis = _orient(s[1])
		eye.add_child(o)
		o.add_child(_blob(Vector3(0.43, 0.43, 0.13), Color("f7f7f4"), Vector3(0, 0, -0.04), 0.35))
		o.add_child(_blob(Vector3(0.125, 0.125, 0.05), Squirmling.BEAD, Vector3(-sx * 0.07, -0.02, 0.085), 0.2))
		o.add_child(_blob(Vector3(0.035, 0.035, 0.02), Color.WHITE, Vector3(-sx * 0.07 + 0.04, 0.03, 0.125), 0.1))
		var bs := surface(sx * 0.3, 0.5)
		var brow := head.get_node("Brow" + side) as Node3D
		brow.scale = Vector3(1.1, 1.4, 1.0)
		brow.position = bs[0] + (bs[1] as Vector3) * 0.07
		brow.set_meta("home_y", brow.position.y)
		brow.rotation.x = -asin(clampf((bs[1] as Vector3).y, -1.0, 1.0))
		brow.rotation.y = asin(clampf((bs[1] as Vector3).x, -1.0, 1.0)) * 0.8
	var shapes := {
		"Mouth": [0.17, -0.32, 0.03],
		"MouthSmile": [0.24, -0.3, 0.09],
		"MouthGrimace": [0.2, -0.33, 0.0],
	}
	for nm in shapes:
		var m := head.get_node(nm) as Node3D
		for c in m.get_children():
			c.queue_free()
		var d: Array = shapes[nm]
		_bead_line(m, _arc(d[0], d[1], d[2]), 0.045)
	var oh := head.get_node("MouthOpen") as Node3D
	var os := surface(0.0, -0.4)
	oh.scale = Vector3(1.3, 1.6, 0.6)
	oh.position = (os[0] as Vector3) + (os[1] as Vector3) * 0.01
	var gp := head.get_node("MouthGulp") as Node3D
	var gs := surface(0.0, -0.4)
	gp.position = (gs[0] as Vector3) + (gs[1] as Vector3) * 0.01
	var teeth := head.get_node("MouthTeeth") as Node3D
	var ts := surface(0.0, -0.4)
	teeth.position = Vector3(0, -0.4 + 0.18, (ts[0] as Vector3).z - 0.79)
