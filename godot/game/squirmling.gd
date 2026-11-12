class_name Squirmling
extends RefCounted
## Procedural Squirmling: a chunky toy worm made of five stacked clay rings that taper from the head
## down to a felt-tufted tail (see plan/characters.md). Rings alternate cream and the team colour,
## the head ring is a flattened gumdrop with bead eyes, felt brows and a stitched mouth, and every
## ring lags the one in front when it moves. Built at its own size and scaled so it stands 6 voxels
## tall with its tail at the node origin, facing +z. This file builds the parts; the node it returns
## is a SquirmlingRig, which owns the motion (walk, jump, hurt, fire, knock-out).

const HEIGHT := 6.0
const LOCAL_TOP := 2.62
const SCALE := HEIGHT / LOCAL_TOP
const RING_COUNT := 5
## Tail (0) to head (4).
const RING_RADIUS := [0.46, 0.58, 0.68, 0.76, 0.84]
const RING_SQUASH := 0.62
const RING_STEP := 0.46

const CREAM := Color("f3e3c3")
const FELT := Color("6b4a32")
const BEAD := Color("1d1a1a")
const BRASS := Color("e8b84a")
const WOOD := Color("b98552")

static var _mats: Dictionary = {}
static var _clay_normal: NoiseTexture2D


static func _mat(color: Color, roughness := 0.9) -> StandardMaterial3D:
	var key := "%s/%s" % [color.to_html(), roughness]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	_mats[key] = m
	return m


## Thumb-pressed clay: a soft bumpy normal map shared by every ring, plus a faint rim so the
## rings read as round against the sunset.
static func _clay(color: Color) -> StandardMaterial3D:
	var key := "clay/%s" % color.to_html()
	if _mats.has(key):
		return _mats[key]
	if _clay_normal == null:
		var noise := FastNoiseLite.new()
		noise.noise_type = FastNoiseLite.TYPE_CELLULAR
		noise.frequency = 0.045
		noise.fractal_octaves = 2
		_clay_normal = NoiseTexture2D.new()
		_clay_normal.width = 256
		_clay_normal.height = 256
		_clay_normal.seamless = true
		_clay_normal.as_normal_map = true
		_clay_normal.bump_strength = 5.0
		_clay_normal.noise = noise
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.92
	m.normal_enabled = true
	m.normal_texture = _clay_normal
	m.normal_scale = 0.4
	m.uv1_scale = Vector3(3.0, 2.0, 1.0)
	m.rim_enabled = true
	m.rim = 0.35
	m.rim_tint = 0.5
	_mats[key] = m
	return m


static func _part(mesh: Mesh, color: Color, pos := Vector3.ZERO, roughness := 0.9) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _mat(color, roughness)
	mi.position = pos
	return mi


static func _sphere(radius: float, hemi := false) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius if hemi else radius * 2.0
	s.is_hemisphere = hemi
	s.radial_segments = 20
	s.rings = 12
	return s


static func _cyl(top: float, bottom: float, h: float, segs := 16) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = h
	c.radial_segments = segs
	return c


static func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


## Hats live in their own module (godot/game/hats/hats.gd); this keeps the old entry point.
static func build_hat(style: String, color: Color) -> Node3D:
	return Hats.make(style, color)


## Centre of ring i (0 = tail, 4 = head) when standing still: a gentle S-curve up the body.
static func ring_base(i: int) -> Vector3:
	return Vector3(sin(float(i) * 1.3) * 0.1, 0.23 + float(i) * RING_STEP, 0.0)


## Bead eyes with a glint, felt brows that carry the mood, a stitched zig-zag mouth and a round
## "oh!" mouth that the rig swaps in when the Squirmling is hit, firing or in the air.
static func _face(head: Node3D) -> void:
	for sx in [-1.0, 1.0]:
		var side := "L" if sx < 0.0 else "R"
		var eye := Node3D.new()
		eye.name = "Eye" + side
		eye.position = Vector3(sx * 0.31, 0.02, 0.72)
		eye.add_child(_part(_sphere(0.085), BEAD, Vector3.ZERO, 0.25))
		eye.add_child(_part(_sphere(0.028), Color.WHITE, Vector3(0.03, 0.035, 0.07), 0.2))
		head.add_child(eye)
		var brow := _part(_box(Vector3(0.26, 0.07, 0.1)), FELT, Vector3(sx * 0.31, 0.21, 0.67), 1.0)
		brow.name = "Brow" + side
		brow.set_meta("side", sx)
		brow.rotation.z = deg_to_rad(-6.0 * sx)
		head.add_child(brow)
	var mouth := Node3D.new()
	mouth.name = "Mouth"
	for k in range(4):
		var seg := _part(_box(Vector3(0.1, 0.025, 0.03)), BEAD, Vector3(-0.15 + 0.1 * k, -0.17 + 0.03 * (k % 2), 0.73), 0.6)
		seg.rotation.z = deg_to_rad(30.0 if k % 2 == 0 else -30.0)
		mouth.add_child(seg)
	head.add_child(mouth)
	var oh := _part(_sphere(0.09), BEAD, Vector3(0.0, -0.17, 0.7), 0.5)
	oh.name = "MouthOpen"
	oh.scale = Vector3(1.0, 1.2, 0.5)
	oh.visible = false
	head.add_child(oh)


## A felt tool belt with a brass buckle and a pouch, worn around the second ring.
static func _belt(ring: Node3D, radius: float) -> void:
	var belt := Node3D.new()
	belt.name = "Belt"
	belt.add_child(_part(_cyl(radius * 1.0, radius * 1.0, 0.11, 24), FELT, Vector3.ZERO, 1.0))
	belt.add_child(_part(_box(Vector3(0.16, 0.14, 0.05)), BRASS, Vector3(0, 0, radius), 0.35))
	belt.add_child(_part(_box(Vector3(0.07, 0.2, 0.18)), FELT.lightened(0.15), Vector3(radius, -0.05, 0.1), 1.0))
	ring.add_child(belt)


## What a knocked-out Squirmling leaves behind: the bare peg of a stacking toy with one ring in
## the team colour still on it.
static func _marker(team_color: Color) -> Node3D:
	var marker := Node3D.new()
	marker.name = "Marker"
	marker.scale = Vector3.ONE * SCALE
	var base := _part(_sphere(0.5), team_color, Vector3(0, 0.16, 0), 0.95)
	base.material_override = _clay(team_color)
	base.scale = Vector3(1.0, 0.5, 1.0)
	marker.add_child(base)
	marker.add_child(_part(_cyl(0.09, 0.11, 1.1, 12), WOOD, Vector3(0, 0.6, 0), 0.8))
	marker.add_child(_part(_sphere(0.14), WOOD.lightened(0.1), Vector3(0, 1.17, 0), 0.7))
	marker.visible = false
	return marker


## One Squirmling, tail at the origin, facing +z, 6 voxels tall. Drive it every frame with
## `SquirmlingRig.drive`, and call `hurt`, `fire` and `set_alive` as things happen to it.
static func create(_team: int, hat_style: String, team_color: Color) -> SquirmlingRig:
	var root := SquirmlingRig.new()
	root.name = "Squirmling"
	var model := Node3D.new()
	model.name = "Model"
	model.scale = Vector3.ONE * SCALE
	root.add_child(model)

	for i in range(RING_COUNT):
		var ring := Node3D.new()
		ring.name = "Ring%d" % i
		ring.position = ring_base(i)
		# Head (4) in the team colour, then alternating with cream down to a team-coloured tail.
		var band := team_color if (RING_COUNT - 1 - i) % 2 == 0 else CREAM
		var body := _part(_sphere(RING_RADIUS[i]), band)
		body.material_override = _clay(band)
		body.scale = Vector3(1.0, RING_SQUASH, 1.0)
		ring.add_child(body)
		model.add_child(ring)

		if i == 0:
			var tuft := _part(_cyl(0.0, 0.12, 0.34, 8), FELT, Vector3(0, -0.2, -0.28), 1.0)
			tuft.name = "TailTuft"
			tuft.rotation.x = deg_to_rad(-35.0)
			ring.add_child(tuft)
		elif i == 1:
			_belt(ring, RING_RADIUS[i])
		elif i == RING_COUNT - 1:
			_face(ring)
			var hat := build_hat(hat_style, team_color)
			hat.position.y = RING_RADIUS[i] * RING_SQUASH - 0.24
			ring.add_child(hat)

	root.add_child(_marker(team_color))

	var tag := Label3D.new()
	tag.name = "Tag"
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.no_depth_test = true
	tag.fixed_size = false
	tag.pixel_size = 0.03
	tag.font_size = 48
	tag.outline_size = 14
	tag.modulate = Color.WHITE
	tag.position = Vector3(0, HEIGHT + 1.6, 0)
	root.add_child(tag)
	root.bind()
	return root


## Old entry point, kept for callers that only know a clock: one 60 Hz step of the rig.
static func animate(root: Node3D, _t: float, active: bool, moving := false) -> void:
	var rig := root as SquirmlingRig
	if rig != null:
		rig.drive(1.0 / 60.0, active, Vector3(0, 0, 6.0) if moving else Vector3.ZERO, true)


## Set the floating tag (name and health) above a critter.
static func set_tag(root: Node3D, text: String, color: Color) -> void:
	var tag := root.get_node_or_null("Tag") as Label3D
	if tag != null:
		tag.text = text
		tag.modulate = color
