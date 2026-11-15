class_name CameraMath
extends RefCounted
## Camera and aim maths, ported from client/src/game3d/cameraRig.ts with the same numbers and feel.
## Y is up. Camera yaw 0 looks along -z (the camera sits at +z of its target) and grows counter-clockwise
## seen from above. Headings are degrees with 0 = +z and 90 = +x. The wire yaw (sim units) is
## 0..1023 with 0 = +x and 256 = +z, see docs/view-protocol.md.

const YAW_STEPS := 1024
const ORBIT_MIN_PITCH := 8.0
const ORBIT_MAX_PITCH := 85.0
const ORBIT_MIN_DIST := 12.0
const ORBIT_MAX_DIST := 160.0
const AIM_DIST := 14.0
const AIM_MIN_PITCH := -20
const AIM_MAX_PITCH := 80
const CHARGE_PER_SECOND := 70.0
## The first-person aim camera tips only this share of the aim angle, so the horizon and the target
## stay in view; the crosshair moves up the screen to show the real aim (HudModel.crosshair_offset).
const FIRST_PERSON_PITCH_SHARE := 0.5


## Wrap degrees into [0, 360).
static func wrap_deg(d: float) -> float:
	return fposmod(d, 360.0)


## Wire yaw (0 = +x, 256 = +z) to a heading in degrees (0 = +z, 90 = +x).
static func yaw_to_deg(yaw: int) -> float:
	return wrap_deg(90.0 - float(yaw) * 360.0 / float(YAW_STEPS))


## Heading in degrees to the nearest wire yaw 0..1023.
static func deg_to_yaw(deg: float) -> int:
	var steps := int(roundf(wrap_deg(90.0 - deg) * float(YAW_STEPS) / 360.0))
	return posmod(steps, YAW_STEPS)


## Unit vector from the target toward the camera for a yaw and pitch in degrees.
static func offset_dir(yaw_deg: float, pitch_deg: float) -> Vector3:
	var cp := cos(deg_to_rad(pitch_deg))
	return Vector3(
		cp * sin(deg_to_rad(yaw_deg)), sin(deg_to_rad(pitch_deg)), cp * cos(deg_to_rad(yaw_deg))
	)


## Ground-plane unit vector pointing away from the camera.
static func ground_forward(yaw_deg: float) -> Vector3:
	return Vector3(-sin(deg_to_rad(yaw_deg)), 0.0, -cos(deg_to_rad(yaw_deg)))


## Ground-plane unit vector pointing to the camera's right.
static func ground_right(yaw_deg: float) -> Vector3:
	return Vector3(cos(deg_to_rad(yaw_deg)), 0.0, -sin(deg_to_rad(yaw_deg)))


## Walk direction (unit, on the ground) for WASD relative to the camera, or Vector3.ZERO when idle.
## forward and right are -1, 0 or 1 (W/S and D/A).
static func move_relative_to_camera(yaw_deg: float, forward: int, right: int) -> Vector3:
	if forward == 0 and right == 0:
		return Vector3.ZERO
	var v := ground_forward(yaw_deg) * float(forward) + ground_right(yaw_deg) * float(right)
	return v.normalized()


## Heading in degrees (0 = +z, 90 = +x) of a ground-plane direction.
static func heading_of(dir: Vector3) -> float:
	return wrap_deg(rad_to_deg(atan2(dir.x, dir.z)))


## Shortest signed angle from a to b in degrees.
static func angle_delta(from: float, to: float) -> float:
	return fposmod(to - from + 180.0, 360.0) - 180.0


## Exponential smoothing factor for a frame, independent of frame rate.
static func smoothing(rate: float, dt: float) -> float:
	return 1.0 - exp(-rate * dt)


## Camera yaw that looks along a shot heading (the camera sits behind the shooter).
static func camera_yaw_for_heading(heading_deg: float) -> float:
	return wrap_deg(heading_deg + 180.0)


# ------------------------------------------------------------------ aim


class AimState:
	extends RefCounted
	## Wire yaw 0..1023 (0 = +x, 256 = +z) and whole-degree pitch, exactly as sent in fire commands.
	var yaw: int = 0
	var pitch_deg: int = 30
	## 0..100.
	var power: float = 0.0
	var charging: bool = false

	func duplicate_state() -> AimState:
		var a := AimState.new()
		a.yaw = yaw
		a.pitch_deg = pitch_deg
		a.power = power
		a.charging = charging
		return a


static func new_aim(heading_deg: float) -> AimState:
	var a := AimState.new()
	a.yaw = deg_to_yaw(heading_deg)
	return a


## Turn the crosshair by a mouse movement in pixels. Whole degrees keep the command an integer.
static func nudge_aim(a: AimState, dx_px: float, dy_px: float, sensitivity := 0.25) -> AimState:
	var n := a.duplicate_state()
	n.yaw = deg_to_yaw(yaw_to_deg(a.yaw) - dx_px * sensitivity)
	n.pitch_deg = int(
		roundf(clampf(float(a.pitch_deg) - dy_px * sensitivity, AIM_MIN_PITCH, AIM_MAX_PITCH))
	)
	return n


## Charge up while the fire key is held; power stops at 100.
static func charge_aim(a: AimState, dt: float) -> AimState:
	if not a.charging:
		return a
	var n := a.duplicate_state()
	n.power = minf(100.0, a.power + CHARGE_PER_SECOND * dt)
	return n


## Unit direction of the shot in world space (display only).
static func aim_direction(a: AimState) -> Vector3:
	var cp := cos(deg_to_rad(float(a.pitch_deg)))
	var yaw := deg_to_rad(yaw_to_deg(a.yaw))
	return Vector3(cp * sin(yaw), sin(deg_to_rad(float(a.pitch_deg))), cp * cos(yaw))


# ------------------------------------------------------------------ rig


class RigState:
	extends RefCounted
	var mode: String = "orbit"
	var yaw_deg: float = 30.0
	var pitch_deg: float = 35.0
	var dist: float = 60.0
	var target: Vector3 = Vector3(128, 30, 128)

	func duplicate_state() -> RigState:
		var r := RigState.new()
		r.mode = mode
		r.yaw_deg = yaw_deg
		r.pitch_deg = pitch_deg
		r.dist = dist
		r.target = target
		return r


## Orbit by a mouse drag in pixels. Dragging right swings the camera round, like grabbing the world.
static func drag_orbit(r: RigState, dx_px: float, dy_px: float, sensitivity := 0.3) -> RigState:
	var n := r.duplicate_state()
	n.yaw_deg = wrap_deg(r.yaw_deg - dx_px * sensitivity)
	n.pitch_deg = clampf(r.pitch_deg + dy_px * sensitivity, ORBIT_MIN_PITCH, ORBIT_MAX_PITCH)
	return n


## Wheel zoom, multiplicative so each notch feels the same at any distance.
static func zoom(r: RigState, wheel_delta: float) -> RigState:
	var n := r.duplicate_state()
	n.dist = clampf(r.dist * exp(wheel_delta * 0.001), ORBIT_MIN_DIST, ORBIT_MAX_DIST)
	return n


static func rig_position(r: RigState) -> Vector3:
	return r.target + offset_dir(r.yaw_deg, r.pitch_deg) * r.dist


## Move the rig toward a goal. A goal is {mode, target, optional yaw_deg, pitch_deg, dist}.
## Orbit keeps the player's yaw, pitch and zoom unless the goal overrides them.
## `rate_scale` stretches how quickly the orbit and follow cameras catch up (the smoothing
## setting); the first-person aim camera ignores it so aiming stays crisp.
static func step_rig(r: RigState, goal: Dictionary, dt: float, rate_scale := 1.0) -> RigState:
	var mode: String = goal.get("mode", "orbit")
	var rate := 14.0 if mode == "aim" else (5.0 if mode == "follow" else 6.0)
	if mode != "aim":
		rate *= rate_scale
	var k := smoothing(rate, dt)
	var n := r.duplicate_state()
	n.mode = mode
	n.target = r.target + (goal["target"] as Vector3 - r.target) * k
	if goal.has("yaw_deg"):
		n.yaw_deg = wrap_deg(r.yaw_deg + angle_delta(r.yaw_deg, float(goal["yaw_deg"])) * k)
	if goal.has("pitch_deg"):
		n.pitch_deg = r.pitch_deg + (float(goal["pitch_deg"]) - r.pitch_deg) * k
	if goal.has("dist"):
		n.dist = r.dist + (float(goal["dist"]) - r.dist) * k
	return n


# ------------------------------------------------------------------ terrain pull-in

## How the third-person camera avoids terrain between it and its target.
const PULL_FULL := 0  ## pulled in at once, eased back out
const PULL_REDUCED := 1  ## pulled in smoothly, eased back out slowly: no snapping
const PULL_OFF := 2  ## never pulled in (it still stays above the ground)
const PULL_NAMES: Array[String] = ["Full", "Reduced", "Off"]

## The line must pass this far above the ground to count as clear.
const PULL_CLEARANCE := 1.5
## Ground this close to the target (voxels) is the target's own surroundings and is ignored.
const PULL_SKIP_NEAR := 6.0
## A block must show on this many probe samples in a row, so a thin post, a prop or a single
## voxel bump does not pull the camera in.
const PULL_MIN_RUN := 2
## Hysteresis: the camera only eases back out once the way is clear by this much (voxels).
const PULL_EASE_OUT_GAP := 3.0
## In "reduced" mode a pull-in smaller than this is ignored.
const PULL_EASE_IN_GAP := 0.75


## How far along the line from `target` to `pos` the camera can go before ground that is wide
## enough to matter rises above the line. `ground` is a Callable (x, z) -> height; `world` is the
## map size in voxels (the probe skips points outside it). Never less than `min_dist` (or the
## whole span if that is shorter).
static func clear_distance(target: Vector3, pos: Vector3, ground: Callable, world: Vector2, min_dist: float, steps := 40) -> float:
	var span := target.distance_to(pos)
	if span <= 0.001:
		return span
	var run := 0
	for i in range(1, steps + 1):
		var t := float(i) / float(steps)
		var p := target.lerp(pos, t)
		if span * t < PULL_SKIP_NEAR:
			continue
		if p.x < 0.0 or p.z < 0.0 or p.x >= world.x or p.z >= world.y:
			run = 0
			continue
		if p.y < float(ground.call(p.x, p.z)) + PULL_CLEARANCE:
			run += 1
			if run >= PULL_MIN_RUN:
				var first := t - float(PULL_MIN_RUN) / float(steps)
				return clampf(span * first - 1.5, minf(min_dist, span), span)
		else:
			run = 0
	return span


## One frame of the camera's pull-in distance. `pull` is the current limit (a huge number when
## nothing pulls), `span` the wanted distance and `allowed` what the probe says is clear.
static func step_pull(pull: float, span: float, allowed: float, mode: int, dt: float) -> float:
	if mode == PULL_OFF:
		return 1.0e9
	pull = minf(pull, span)
	if mode == PULL_FULL:
		if allowed < pull:
			return allowed
		if allowed > pull + PULL_EASE_OUT_GAP:
			return lerpf(pull, allowed, smoothing(3.0, dt))
		return pull
	if allowed < pull - PULL_EASE_IN_GAP:
		return lerpf(pull, allowed, smoothing(7.0, dt))
	if allowed > pull + PULL_EASE_OUT_GAP:
		return lerpf(pull, allowed, smoothing(1.0, dt))
	return pull


## Lift for the camera's height so it never sinks under the ground: `need` is how far it would
## be under the floor. Rises quickly and settles back slowly, so a bump does not make it pump.
static func step_lift(lift: float, need: float, dt: float) -> float:
	var rate := 10.0 if need > lift else 2.0
	return lerpf(lift, maxf(need, 0.0), smoothing(rate, dt))
