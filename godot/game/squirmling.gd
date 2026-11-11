class_name Squirmling
extends RefCounted
## Procedural Squirmling: a chunky toy worm made of five stacked clay rings that taper from the head
## down to a felt-tufted tail (see plan/characters.md). Rings alternate cream and the team colour,
## the head ring is a flattened gumdrop with bead eyes, felt brows and a stitched mouth, and every
## ring lags the one in front when it moves. Built at its own size and scaled so it stands 6 voxels
## tall with its tail at the node origin, facing +z. Real models replace this later; keep the API.

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

static var _mats: Dictionary = {}


static func _mat(color: Color, roughness := 0.9) -> StandardMaterial3D:
	var key := "%s/%s" % [color.to_html(), roughness]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
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


static func _face(head: Node3D) -> void:
	for sx in [-1.0, 1.0]:
		head.add_child(_part(_sphere(0.075), BEAD, Vector3(sx * 0.3, 0.02, 0.72), 0.3))
		head.add_child(_part(_sphere(0.026), Color.WHITE, Vector3(sx * 0.3 + 0.025, 0.05, 0.785), 0.2))
		var brow := _part(_box(Vector3(0.24, 0.06, 0.1)), FELT, Vector3(sx * 0.3, 0.2, 0.67), 1.0)
		brow.rotation.z = deg_to_rad(-12.0 * sx)
		head.add_child(brow)
	# Stitched zig-zag mouth.
	for k in range(4):
		var seg := _part(_box(Vector3(0.1, 0.025, 0.03)), BEAD, Vector3(-0.15 + 0.1 * k, -0.17 + 0.03 * (k % 2), 0.73), 0.6)
		seg.rotation.z = deg_to_rad(30.0 if k % 2 == 0 else -30.0)
		head.add_child(seg)


## One Squirmling, tail at the origin, facing +z, 6 voxels tall.
static func create(_team: int, hat_style: String, team_color: Color) -> Node3D:
	var root := Node3D.new()
	root.name = "Squirmling"
	var model := Node3D.new()
	model.name = "Model"
	model.scale = Vector3.ONE * SCALE
	root.add_child(model)

	for i in range(RING_COUNT):
		var ring := Node3D.new()
		ring.name = "Ring%d" % i
		ring.position = ring_base(i)
		ring.set_meta("base", ring.position)
		# Head (4) in the team colour, then alternating with cream down to a team-coloured tail.
		var band := team_color if (RING_COUNT - 1 - i) % 2 == 0 else CREAM
		var body := _part(_sphere(RING_RADIUS[i]), band, Vector3.ZERO, 0.95)
		body.scale = Vector3(1.0, RING_SQUASH, 1.0)
		ring.add_child(body)
		model.add_child(ring)

		if i == 0:
			var tuft := _part(_cyl(0.0, 0.12, 0.34, 8), FELT, Vector3(0, -0.2, -0.28), 1.0)
			tuft.name = "TailTuft"
			tuft.rotation.x = deg_to_rad(-35.0)
			ring.add_child(tuft)
		elif i == RING_COUNT - 1:
			_face(ring)
			var hat := build_hat(hat_style, team_color)
			hat.position.y = RING_RADIUS[i] * RING_SQUASH - 0.24
			ring.add_child(hat)

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
	return root


## Per-frame animation. Each ring follows the one in front a little later, so the body ripples.
## `moving` adds the inchworm scrunch; `active` adds a small idle breathing; the propeller spins.
static func animate(root: Node3D, t: float, active: bool, moving := false) -> void:
	var model := root.get_node_or_null("Model") as Node3D
	if model == null:
		return
	var rate := 9.0 if moving else 2.2
	var sway := 0.12 if moving else (0.05 if active else 0.02)
	var squash := 1.0
	if moving:
		squash = 1.0 - 0.1 * (0.5 + 0.5 * sin(t * rate))
	for i in range(RING_COUNT):
		var ring := model.get_node_or_null("Ring%d" % i) as Node3D
		if ring == null:
			continue
		var base: Vector3 = ring.get_meta("base")
		var lag := sin(t * rate - float(i) * 0.7)
		ring.position = Vector3(base.x + lag * sway * (float(i) + 1.0) * 0.3, base.y * squash, base.z)
	var tuft := model.find_child("TailTuft", true, false) as Node3D
	if tuft != null:
		tuft.rotation.x = deg_to_rad(-35.0) + sin(t * (14.0 if moving else 5.0)) * 0.35
	var prop := model.find_child("Propeller", true, false) as Node3D
	if prop != null:
		prop.rotation.y = t * 14.0


## Set the floating tag (name and health) above a critter.
static func set_tag(root: Node3D, text: String, color: Color) -> void:
	var tag := root.get_node_or_null("Tag") as Label3D
	if tag != null:
		tag.text = text
		tag.modulate = color
