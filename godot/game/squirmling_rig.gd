class_name SquirmlingRig
extends Node3D
## The moving part of a Squirmling. `Squirmling.create` builds the rings, face and hat and returns
## one of these; the match scene calls `drive` every frame and `hurt`, `fire` and `set_alive` when
## the referee says so. Nothing here runs on its own, so tests can step it by hand.
##
## The body is a chain of springs. Each ring has a sideways offset that chases a goal with its own
## stiffness (softer towards the head), so the rings lag one another, overshoot and wobble. One more
## spring stretches and squashes the whole stack: breathing, the inchworm scrunch, take-off stretch
## and landing squash all push on it.

const N := Squirmling.RING_COUNT
const POP_SECONDS := 1.5
const HURT_SECONDS := 0.7
const FIRE_SECONDS := 0.4

var alive := true
## Seconds since the rings popped apart, or -1 when they are not flying.
var pop_time := -1.0

var _model: Node3D
var _marker: Node3D
var _tag: Node3D
var _rings: Array[Node3D] = []
var _eyes: Array[Node3D] = []
var _brows: Array[Node3D] = []
var _mouth: Node3D
var _mouth_open: Node3D
var _tuft: Node3D
var _prop: Node3D

var _off := PackedVector2Array()  # per ring: sideways (x) and forward (y -> model z) offset
var _vel := PackedVector2Array()
var _stretch := 1.0
var _stretch_v := 0.0
var _t := 0.0
var _phase := 0.0
var _hurt := 0.0
var _fire := 0.0
var _blink := 0.0
var _next_blink := 2.0
var _mood := 0.0  # -1 worried, 0 calm, 1 determined
var _head_pitch := 0.0
var _was_grounded := true
var _ever_driven := false
var _pop_vel: Array[Vector3] = []
var _pop_spin: Array[Vector3] = []
var _marker_scale := 0.0
var _rng := RandomNumberGenerator.new()


## Called once by `Squirmling.create` after the parts exist.
func bind() -> void:
	_model = get_node("Model") as Node3D
	_marker = get_node("Marker") as Node3D
	_tag = get_node_or_null("Tag") as Node3D
	for i in range(N):
		_rings.append(_model.get_node("Ring%d" % i) as Node3D)
	var head := _rings[N - 1]
	for side in ["L", "R"]:
		_eyes.append(head.get_node("Eye" + side) as Node3D)
		_brows.append(head.get_node("Brow" + side) as Node3D)
	_mouth = head.get_node("Mouth") as Node3D
	_mouth_open = head.get_node("MouthOpen") as Node3D
	_tuft = _model.find_child("TailTuft", true, false) as Node3D
	_prop = _model.find_child("Propeller", true, false) as Node3D
	_off.resize(N)
	_vel.resize(N)
	_rng.seed = 7919
	_marker_scale = _marker.scale.x


## Give each Squirmling its own rhythm so a row of them does not move in step.
func set_seed(s: int) -> void:
	_rng.seed = s * 2654435761 + 7919
	_t = _rng.randf() * 10.0
	_next_blink = _t + 1.0 + _rng.randf() * 3.0


## One frame. `velocity` is in world units per second; `aim_pitch_deg` tips the head up while the
## player is aiming (0 when not).
func drive(dt: float, active: bool, velocity: Vector3, grounded: bool, aim_pitch_deg := 0.0) -> void:
	dt = clampf(dt, 0.0, 0.05)
	_t += dt
	_ever_driven = true
	if pop_time >= 0.0:
		_step_pop(dt)
		return
	if not alive:
		return
	_hurt = maxf(0.0, _hurt - dt)
	_fire = maxf(0.0, _fire - dt)

	# Velocity in the model's own frame and units.
	var local := velocity.rotated(Vector3.UP, -rotation.y) / Squirmling.SCALE
	var flat := Vector2(local.x, local.z)
	var speed := flat.length()
	var moving := grounded and speed > 0.2

	# Stretch and squash of the whole stack.
	var goal_stretch := 1.0 + 0.025 * sin(_t * 2.2)
	if moving:
		_phase += dt * (7.0 + minf(speed, 8.0) * 0.9)
		goal_stretch = 1.0 - 0.15 * (0.5 + 0.5 * sin(_phase))
	if not grounded:
		goal_stretch = 1.0 + clampf(local.y * 0.045, -0.1, 0.24)
	if grounded and not _was_grounded:
		_stretch_v -= 3.2  # landing squash
	elif not grounded and _was_grounded:
		_stretch_v += 2.6  # the spring of a jump
	_was_grounded = grounded
	_stretch_v += ((goal_stretch - _stretch) * 180.0 - _stretch_v * 11.0) * dt
	_stretch = clampf(_stretch + _stretch_v * dt, 0.5, 1.45)

	# The ring chain: the head end trails behind the motion, sways when idle, ripples when walking.
	for i in range(N):
		var w := pow(float(i) / float(N - 1), 1.4)
		var goal := (-flat * 0.05).limit_length(0.42) * w
		goal.x += sin(_t * 1.7 - float(i) * 0.7) * (0.07 if active else 0.035) * w
		if moving:
			goal.y += sin(_phase - float(i) * 0.8) * 0.12 * w
		var stiff := 130.0 - 14.0 * float(i)
		_vel[i] += ((goal - _off[i]) * stiff - _vel[i] * 7.0) * dt
		_off[i] += _vel[i] * dt
	_pose_rings()

	# Head: look around when idle, tip up with the aim.
	var head := _rings[N - 1]
	_head_pitch = lerpf(_head_pitch, -deg_to_rad(aim_pitch_deg) * 0.45, minf(1.0, dt * 8.0))
	head.rotation.x += _head_pitch
	head.rotation.y = 0.0 if active else sin(_t * 0.6) * 0.3

	_face(dt, active, grounded)
	if _tuft != null:
		var flick := sin(_t * (14.0 if moving else 5.0)) * (0.35 if moving else 0.12)
		# A quick double flick every few seconds while standing.
		if not moving and fposmod(_t, 3.7) < 0.5:
			flick = sin(_t * 26.0) * 0.5
		_tuft.rotation.x = deg_to_rad(-35.0) + flick
	if _prop != null:
		_prop.rotation.y = _t * 14.0


## Hit: the rings squash and wobble, the face scrunches.
func hurt() -> void:
	if not alive:
		return
	_hurt = HURT_SECONDS
	_stretch_v -= 4.5
	for i in range(N):
		var w := float(i + 1) / float(N)
		var side := 1.0 if i % 2 == 0 else -1.0
		_vel[i] += Vector2(side * 2.4, _rng.randf_range(-1.2, 1.2)) * w


## Fired a weapon: the body kicks backwards from the head down and springs back.
func fire() -> void:
	if not alive:
		return
	_fire = FIRE_SECONDS
	_stretch_v -= 1.8
	for i in range(N):
		_vel[i] += Vector2(0.0, -4.0) * pow(float(i) / float(N - 1), 1.2)


## Alive or knocked out. Going from alive to knocked out pops the rings apart, then leaves the
## marker. A Squirmling first seen knocked out goes straight to the marker.
func set_alive(value: bool) -> void:
	if value == alive:
		return
	alive = value
	if alive:
		pop_time = -1.0
		_model.visible = true
		_marker.visible = false
		if _tag != null:
			_tag.visible = true
		for ring in _rings:
			ring.scale = Vector3.ONE
		_pose_rings()
		return
	if _tag != null:
		_tag.visible = false
	if not _ever_driven:
		_show_marker(1.0)
		return
	pop_time = 0.0
	_pop_vel.clear()
	_pop_spin.clear()
	for i in range(N):
		var ang := TAU * (float(i) / float(N)) + _rng.randf_range(-0.5, 0.5)
		var out := _rng.randf_range(1.6, 3.2)
		_pop_vel.append(Vector3(cos(ang) * out, _rng.randf_range(3.5, 6.0), sin(ang) * out))
		_pop_spin.append(Vector3(_rng.randf_range(-7.0, 7.0), 0.0, _rng.randf_range(-7.0, 7.0)))


func is_wobbling() -> bool:
	return _hurt > 0.0 or _fire > 0.0


func _pose_rings() -> void:
	var wide := 1.0 / sqrt(_stretch)
	for i in range(N):
		var ring := _rings[i]
		var base := Squirmling.ring_base(i)
		ring.position = Vector3(base.x + _off[i].x, base.y * _stretch, _off[i].y)
		# The head keeps more of its shape so the face and hat do not smear.
		var k := 0.5 if i == N - 1 else 1.0
		ring.scale = Vector3(lerpf(1.0, wide, k), lerpf(1.0, _stretch, k), lerpf(1.0, wide, k))
		var below := _off[i - 1] if i > 0 else Vector2.ZERO
		var above := _off[i + 1] if i < N - 1 else _off[i] * 2.0 - below
		var lean := (above - below) / (2.0 * Squirmling.RING_STEP)
		ring.rotation = Vector3(atan(lean.y) * 0.8, 0.0, -atan(lean.x) * 0.8)


func _face(dt: float, active: bool, grounded: bool) -> void:
	if _t >= _next_blink:
		_blink = 0.13
		_next_blink = _t + 1.8 + _rng.randf() * 3.5
	_blink = maxf(0.0, _blink - dt)
	var lid := 1.0
	if _hurt > 0.0:
		lid = 0.22
	elif _blink > 0.0:
		lid = 0.12
	elif _fire > 0.0:
		lid = 0.55
	for eye in _eyes:
		eye.scale = Vector3(1.0, lerpf(eye.scale.y, lid, minf(1.0, dt * 30.0)), 1.0)
	var mood := 0.0
	if _hurt > 0.0 or not grounded:
		mood = -1.0
	elif active or _fire > 0.0:
		mood = 1.0
	_mood = lerpf(_mood, mood, minf(1.0, dt * 10.0))
	for brow in _brows:
		var sx: float = brow.get_meta("side", 1.0)
		# Determined: inner ends down. Worried: inner ends up and the whole brow lifts.
		brow.rotation.z = deg_to_rad((-6.0 + 22.0 * _mood) * sx)
		brow.position.y = 0.22 + maxf(0.0, -_mood) * 0.06
	var open := _hurt > 0.0 or _fire > 0.0 or not grounded
	_mouth_open.visible = open
	_mouth.visible = not open


func _step_pop(dt: float) -> void:
	pop_time += dt
	var fade := clampf((POP_SECONDS - pop_time) / 0.4, 0.0, 1.0)
	for i in range(N):
		var ring := _rings[i]
		var v := _pop_vel[i]
		v.y -= 14.0 * dt
		var p := ring.position + v * dt
		var floor_y: float = float(Squirmling.RING_RADIUS[i]) * Squirmling.RING_SQUASH
		if p.y < floor_y and v.y < 0.0:
			p.y = floor_y
			v = Vector3(v.x * 0.7, -v.y * 0.45, v.z * 0.7)
			_pop_spin[i] *= 0.6
		_pop_vel[i] = v
		ring.position = p
		ring.rotation += _pop_spin[i] * dt
		ring.scale = Vector3.ONE * fade
	if pop_time >= POP_SECONDS:
		pop_time = -1.0
		_show_marker(0.0)


func _show_marker(grown: float) -> void:
	_model.visible = false
	_marker.visible = true
	_marker.scale = Vector3.ONE * _marker_scale * maxf(grown, 0.01)
	if grown < 1.0 and is_inside_tree():
		var tw := create_tween()
		tw.tween_property(_marker, "scale", Vector3.ONE * _marker_scale, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	else:
		_marker.scale = Vector3.ONE * _marker_scale
