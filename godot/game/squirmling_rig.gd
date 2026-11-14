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
var _first_person := false
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
var _look_world := Vector3.INF  # what the Squirmling looks at, or INF for nothing
var _look := Vector2.ZERO  # smoothed head turn (x yaw, y pitch), radians
var _eye_home: Array[Vector3] = []
var _startle := 0.0
var _startle_dir := Vector2.ZERO
var _brow_raise := 0.0  # seconds left of an idle eyebrow raise
var _next_brow := 4.0
var _cheer := false
var _panic := 0.0
var _moving := false
var _walk_amt := 0.0  # 0 standing, 1 walking: fades the inchworm in and out
var _fall_speed := 0.0
var _tilt := Vector2.ZERO  # smoothed ground tilt: x pitch, y roll (radians)
var _ground_normal := Vector3.UP
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
		_eye_home.append(_eyes[_eyes.size() - 1].position)
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
	
	# Walking has hysteresis so a speed that hovers at the threshold does not flicker the gait. The
	# phase advances with distance covered, so the rings never slide ahead of the ground.
	if _moving:
		_moving = grounded and speed > 0.3
	else:
		_moving = grounded and speed > 0.6
	_walk_amt = lerpf(_walk_amt, 1.0 if _moving else 0.0, minf(1.0, dt * 9.0))
	if _moving:
		_phase += dt * speed * 4.2

	# Stretch and squash of the whole stack: a small breath, plus the jump spring and landing squash.
	var goal_stretch := 1.0 + 0.03 * sin(_t * 2.2) * (1.0 - _walk_amt)
	if not grounded:
		goal_stretch = 1.0 + clampf(local.y * 0.045, -0.1, 0.24)
		_fall_speed = maxf(_fall_speed, -local.y)
	if grounded and not _was_grounded:
		_stretch_v -= clampf(1.6 + _fall_speed * 0.4, 1.6, 6.0)  # landing squash, harder from higher
		_fall_speed = 0.0
	elif not grounded and _was_grounded:
		_stretch_v += 2.6  # the spring of a jump
	_was_grounded = grounded
	_stretch_v += ((goal_stretch - _stretch) * 180.0 - _stretch_v * 11.0) * dt
	_stretch = clampf(_stretch + _stretch_v * dt, 0.5, 1.45)

	# Lean into the ground slope, smoothly, about the tail.
	var n := _ground_normal if grounded else Vector3.UP
	var nl := n.rotated(Vector3.UP, -rotation.y)
	var tilt_goal := Vector2(
		clampf(atan2(nl.z, maxf(nl.y, 0.2)), -0.6, 0.6), clampf(-atan2(nl.x, maxf(nl.y, 0.2)), -0.6, 0.6)
	)
	_tilt = _tilt.lerp(tilt_goal, minf(1.0, dt * 8.0))
	_model.rotation = Vector3(_tilt.x, 0.0, _tilt.y)

	# The ring chain: the head end trails behind the motion, sways when idle, ripples when walking.
	for i in range(N):
		var w := pow(float(i) / float(N - 1), 1.4)
		var goal := (-flat * 0.05).limit_length(0.42) * w
		goal.x += sin(_t * 1.7 - float(i) * 0.7) * (0.07 if active else 0.045) * w * (1.0 - _walk_amt)
		goal.y += sin(_phase - float(i) * 0.9) * 0.12 * w * _walk_amt
		var stiff := 130.0 - 14.0 * float(i)
		_vel[i] += ((goal - _off[i]) * stiff - _vel[i] * 7.0) * dt
		_off[i] += _vel[i] * dt
	_pose_rings()

	# Head: look around when idle, tip up with the aim.
	var head := _rings[N - 1]
	_head_pitch = lerpf(_head_pitch, -deg_to_rad(aim_pitch_deg) * 0.45, minf(1.0, dt * 8.0))
	head.rotation.x += _head_pitch
	# Look at the target when there is one (the head follows, the eyes lead), else glance about.
	var look_goal := Vector2(0.0 if active else sin(_t * 0.6) * 0.3, 0.0)
	if _look_world != Vector3.INF and not active and is_inside_tree():
		var to := (_look_world - (global_position + Vector3(0, Squirmling.HEIGHT * 0.8, 0))).rotated(Vector3.UP, -rotation.y)
		look_goal = look_angles(to)
	_look = _look.lerp(look_goal, minf(1.0, dt * 6.0))
	head.rotation.y = _look.x * 0.75
	head.rotation.x += -_look.y * 0.5
	_startle = maxf(0.0, _startle - dt)
	_panic = maxf(0.0, _panic - dt)
	# A startle leans the head away from the blast; panic shakes it.
	if _startle > 0.0:
		head.rotation.z += _startle_dir.x * _startle * 0.5
	if _panic > 0.0:
		head.rotation.z += sin(_t * 40.0) * 0.18
	# Victory: bounce on the spot, head up.
	if _cheer and grounded:
		_stretch_v += 0.0 if fposmod(_t, 0.7) > 0.05 else 3.0
		head.rotation.x -= 0.25

	_face(dt, active, grounded)
	if _tuft != null:
		var flick := sin(_t * (14.0 if _moving else 5.0)) * (0.35 if _moving else 0.12)
		# A quick double flick every few seconds while standing.
		if not _moving and fposmod(_t, 3.7) < 0.5:
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


## The ground's up direction under the Squirmling, in world space. The scene sets it each frame.
func set_ground_normal(n: Vector3) -> void:
	_ground_normal = n


## A jump was just asked for: crouch and coil before the spring (the server's answer comes a
## moment later).
func coil() -> void:
	if alive and _was_grounded:
		_stretch_v -= 2.4


## Fired a weapon: the body kicks backwards from the head down and springs back.
func fire() -> void:
	if not alive:
		return
	_fire = FIRE_SECONDS
	_stretch_v -= 1.8
	for i in range(N):
		_vel[i] += Vector2(0.0, -4.0) * pow(float(i) / float(N - 1), 1.2)


## First-person aim: the camera sits at the head, so hide the body and the tag.
func set_first_person(on: bool) -> void:
	if on == _first_person:
		return
	_first_person = on
	if alive and pop_time < 0.0:
		_model.visible = not on
		if _tag != null:
			_tag.visible = not on


## Text height of a name tag on screen, in pixels at 720 p: big when the critter is close, easing
## down to a floor that is still readable, never smaller. Scaled with the screen height.
const TAG_PX_NEAR := 23.0
const TAG_PX_FAR := 15.0


## On-screen text size in pixels for a tag `dist` voxels from the camera (see TAG_PX_*).
static func tag_pixels(dist: float, screen_h: float) -> float:
	return lerpf(TAG_PX_NEAR, TAG_PX_FAR, smoothstep(20.0, 160.0, dist)) * screen_h / 720.0


## Scale, fade and hide the tag for a camera at `cam`. The tag is scaled so its text is about
## `tag_pixels` tall on screen, fades from 180 voxels and is gone by 260. `blocked` is true when
## terrain is between the camera and the critter's head.
func update_tag(cam: Vector3, blocked: bool, screen_h := 720.0, fov_deg := 60.0) -> void:
	if _tag == null:
		return
	var dist := maxf(cam.distance_to(_tag.global_position), 1.0)
	var fade := 1.0 - smoothstep(180.0, 260.0, dist)
	var label := _tag.get_node_or_null("Name") as Label3D
	var em_world := 1.0 if label == null else float(label.font_size) * label.pixel_size
	var px_per_unit := (screen_h * 0.5) / (dist * tan(deg_to_rad(fov_deg * 0.5)))
	_tag.scale = Vector3.ONE * tag_pixels(dist, screen_h) / (em_world * px_per_unit)
	_tag.visible = alive and pop_time < 0.0 and not _first_person and not blocked and fade > 0.03
	if label != null:
		label.modulate.a = fade
		label.outline_modulate.a = 0.95 * fade
	var bar := _tag.get_node_or_null("Bar") as MeshInstance3D
	if bar != null:
		(bar.material_override as ShaderMaterial).set_shader_parameter("fade", fade)


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
	# Inchworm: the gap above each ring shrinks as a scrunch wave runs tail to head, so the body
	# bunches up, then reaches out again, one ring after the next.
	var height := Squirmling.ring_base(0).y * _stretch
	for i in range(N):
		var ring := _rings[i]
		var base := Squirmling.ring_base(i)
		if i > 0:
			var scrunch := 0.5 + 0.5 * sin(_phase - float(i) * 0.9)
			height += Squirmling.RING_STEP * (_stretch - 0.3 * scrunch * _walk_amt + 0.06 * _walk_amt)
		ring.position = Vector3(base.x + _off[i].x, height, _off[i].y)
		# The head keeps more of its shape so the face and hat do not smear.
		var k := 0.5 if i == N - 1 else 1.0
		ring.scale = Vector3(lerpf(1.0, wide, k), lerpf(1.0, _stretch, k), lerpf(1.0, wide, k))
		var below := _off[i - 1] if i > 0 else Vector2.ZERO
		var above := _off[i + 1] if i < N - 1 else _off[i] * 2.0 - below
		var lean := (above - below) / (2.0 * Squirmling.RING_STEP)
		ring.rotation = Vector3(atan(lean.y) * 0.8, 0.0, -atan(lean.x) * 0.8)


## Head turn (yaw, pitch in radians, clamped) towards a direction in the Squirmling's own frame.
static func look_angles(local_dir: Vector3) -> Vector2:
	var flat := Vector2(local_dir.x, local_dir.z).length()
	var yaw := clampf(atan2(local_dir.x, local_dir.z), -1.0, 1.0)
	var pitch := clampf(atan2(local_dir.y, maxf(flat, 0.001)), -0.5, 0.6)
	return Vector2(yaw, pitch)


## What to look at, in world space. INF looks at nothing.
func set_look_target(p: Vector3) -> void:
	_look_world = p


## A blast went off nearby and missed: eyes wide, brows up, a flinch away from it.
func startle(from_world: Vector3) -> void:
	if not alive:
		return
	_startle = 0.8
	var here := global_position if is_inside_tree() else position
	var away := (here - from_world).rotated(Vector3.UP, -rotation.y)
	_startle_dir = Vector2(clampf(away.x, -1.0, 1.0), clampf(away.z, -1.0, 1.0)).normalized()
	_stretch_v += 1.6
	for i in range(N):
		_vel[i] += _startle_dir * 1.6 * float(i + 1) / float(N)


## Falling into the sea: wide eyes, open mouth, a frantic shake.
func panic() -> void:
	if alive:
		_panic = 1.2
		_startle = maxf(_startle, 1.2)


## Victory pose while true: bouncing, grin, brows up.
func set_cheer(on: bool) -> void:
	_cheer = on


func _face(dt: float, active: bool, grounded: bool) -> void:
	if _t >= _next_blink:
		_blink = 0.13
		# Now and then a double blink.
		_next_blink = _t + (0.22 if _rng.randf() < 0.18 else 1.8 + _rng.randf() * 3.5)
	_blink = maxf(0.0, _blink - dt)
	var lid := 1.0
	if _hurt > 0.0:
		lid = 0.22
	elif _blink > 0.0:
		lid = 0.12
	elif _fire > 0.0:
		lid = 0.55
	if _startle > 0.0 and _hurt <= 0.0:
		lid = 1.35  # wide-eyed
	elif _cheer:
		lid = 0.55  # happy squint
	for k in range(_eyes.size()):
		var eye := _eyes[k]
		eye.scale = Vector3(1.0, lerpf(eye.scale.y, lid, minf(1.0, dt * 30.0)), 1.0)
		# Eyes glance ahead of the head towards what is being looked at.
		var glance := Vector3(_look.x * 0.05, _look.y * 0.04, 0.0)
		eye.position = eye.position.lerp(_eye_home[k] + glance, minf(1.0, dt * 20.0))
	var mood := 0.0
	if _hurt > 0.0 or not grounded:
		mood = -1.0
	elif active or _fire > 0.0:
		mood = 1.0
	_mood = lerpf(_mood, mood, minf(1.0, dt * 10.0))
	# An idle eyebrow raise now and then, one brow a little higher than the other.
	_brow_raise = maxf(0.0, _brow_raise - dt)
	if _t >= _next_brow:
		_brow_raise = 0.45
		_next_brow = _t + 3.0 + _rng.randf() * 5.0
	var raise := sin(clampf(_brow_raise / 0.45, 0.0, 1.0) * PI)
	if _startle > 0.0 or _cheer:
		raise = 1.0
	for bi in range(_brows.size()):
		var brow := _brows[bi]
		var sx: float = brow.get_meta("side", 1.0)
		# Determined: inner ends down. Worried: inner ends up and the whole brow lifts.
		brow.rotation.z = deg_to_rad((-6.0 + 22.0 * _mood) * sx)
		brow.position.y = 0.22 + maxf(0.0, -_mood) * 0.06 + raise * (0.07 if bi == 0 else 0.04)
	var open := _hurt > 0.0 or _fire > 0.0 or not grounded or _startle > 0.3 or _cheer
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
