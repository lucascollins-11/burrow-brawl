class_name CritterSmoother
extends RefCounted
## Visual-only follower for one critter. The server sends 20 Hz states and terrain heights move in
## whole voxels, so the interpolated position still steps and its speed flickers. This chases that
## position with a critically damped spring: no overshoot, continuous velocity, and a ground-hugging
## climb up ledges instead of a pop. Only the picture follows it; the sim is untouched.

## Spring stiffness (rad/s). Higher is tighter. Time to settle is roughly 4 / omega.
const OMEGA_FLAT := 24.0
const OMEGA_GROUND_Y := 15.0
const OMEGA_AIR_Y := 32.0
## A gap this big is a burrow or a respawn: appear there, do not slide.
const SNAP_DISTANCE := 8.0

var pos := Vector3.ZERO
var vel := Vector3.ZERO
var _primed := false


## Move one frame towards `target`. Returns the smoothed position.
func step(target: Vector3, grounded: bool, dt: float) -> Vector3:
	if not _primed or pos.distance_to(target) > SNAP_DISTANCE:
		pos = target
		vel = Vector3.ZERO
		_primed = true
		return pos
	dt = clampf(dt, 0.0, 0.05)
	var oy := OMEGA_GROUND_Y if grounded else OMEGA_AIR_Y
	var ox := Vector3(OMEGA_FLAT, oy, OMEGA_FLAT)
	for a in range(3):
		var w: float = ox[a]
		# Exact integration of x'' = -2w x' - w^2 (x - target): stable at any frame time.
		var d := pos[a] - target[a]
		var e := exp(-w * dt)
		var tmp := (vel[a] + w * d) * dt
		pos[a] = target[a] + (d + tmp) * e
		vel[a] = (vel[a] - w * tmp) * e
	return pos


func reset() -> void:
	_primed = false
	vel = Vector3.ZERO
