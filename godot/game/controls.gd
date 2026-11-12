class_name Controls
extends Node
## Turns keyboard and mouse into match commands (port of client/src/game3d/controls.ts and input3d.ts).
## The server never sees the camera: WASD becomes an absolute walk heading (wire yaw 0..1023) and
## the aim becomes yaw, pitch and power integers.
##
## Default keys (all rebindable in the settings menu): WASD or arrows walk relative to the camera,
## Space jumps, Enter backflips, Tab or F enters aim mode, the mouse aims, hold F to charge and
## release to fire, 1/2 pick a weapon, Z/X set the grenade fuse, Backspace skips the turn. Dragging
## the mouse orbits the camera and the wheel zooms.

## Walk headings are snapped to this many yaw steps so orbiting the camera does not flood the server.
const MOVE_SNAP := 8
const WHEEL_NOTCH := 100.0
## InputMap action -> internal action name queued on a key press.
const KEY_ACTIONS: Array = [
	["jump", "jump"],
	["backflip", "backflip"],
	["skip", "skip"],
	["toggle_aim", "toggle_aim"],
	["cancel_aim", "cancel_aim"],
	["weapon_1", "weapon1"],
	["weapon_2", "weapon2"],
	["fuse_down", "fuse_down"],
	["fuse_up", "fuse_up"],
	["fire", "fire_down"],
]
const WEAPONS: Array[Dictionary] = [
	{"id": "acorn-mortar", "name": "Acorn Mortar"},
	{"id": "fizz-grenade", "name": "Fizz Grenade"},
]

## False when this player has no control (not their turn, settling, game over).
var enabled: bool = true
## Set by the scene each frame: only the control phase may aim and fire.
var can_fire: bool = true
## Set by the scene each frame: camera yaw and the active critter's heading, in degrees.
var camera_yaw_deg: float = 0.0
var heading_deg: float = 0.0
var aim: CameraMath.AimState = null
var weapon: int = 0
var fuse_seconds: int = 3

var _queued: Array = []
var _last_move: int = -1
var _actions: Array[String] = []
var _dx: float = 0.0
var _dy: float = 0.0
var _wheel: float = 0.0
var _dragging: bool = false


func _init() -> void:
	GameSettings.apply_bindings()


func weapon_name() -> String:
	var w: Dictionary = WEAPONS[weapon]
	if w["id"] == "fizz-grenade":
		return "%s (%ds fuse)" % [w["name"], fuse_seconds]
	return str(w["name"])


## Feed every unhandled input event here. Keys come from the InputMap actions in GameSettings.ACTIONS.
func handle_event(ev: InputEvent) -> void:
	if ev is InputEventKey:
		if (ev as InputEventKey).echo:
			return
		for pair in KEY_ACTIONS:
			if ev.is_action_pressed(pair[0]):
				_actions.append(pair[1])
		if ev.is_action_released("fire"):
			_actions.append("fire_up")
	elif ev is InputEventMouseButton:
		var b := ev as InputEventMouseButton
		if b.button_index == MOUSE_BUTTON_WHEEL_UP and b.pressed:
			_wheel -= WHEEL_NOTCH
		elif b.button_index == MOUSE_BUTTON_WHEEL_DOWN and b.pressed:
			_wheel += WHEEL_NOTCH
		elif (
			b.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]
		):
			_dragging = b.pressed
	elif ev is InputEventMouseMotion:
		if _dragging or aim != null:
			var m := ev as InputEventMouseMotion
			_dx += m.relative.x
			_dy += m.relative.y


## Walk keys as -1, 0, 1 axes: forward and right.
func axes() -> Vector2i:
	var f := int(Input.is_action_pressed("move_forward")) - int(Input.is_action_pressed("move_back"))
	var r := int(Input.is_action_pressed("move_right")) - int(Input.is_action_pressed("move_left"))
	return Vector2i(r, f)  # x = right, y = forward


## Once per rendered frame. Returns the mouse movement left over for the orbit camera.
func frame(dt: float) -> Dictionary:
	var scaled := GameSettings.scale_mouse(_dx, _dy)
	var dx := scaled.x
	var dy := scaled.y
	var wheel := _wheel
	_dx = 0.0
	_dy = 0.0
	_wheel = 0.0
	var actions := _actions
	_actions = []
	if not enabled or not can_fire:
		_set_aim(null)
	for a in actions:
		if not enabled:
			break
		match a:
			"jump":
				_queued.append({"k": "jump"})
			"backflip":
				_queued.append({"k": "backflip"})
			"skip":
				_queued.append({"k": "skip"})
			"weapon1":
				weapon = 0
			"weapon2":
				weapon = 1
			"fuse_down":
				fuse_seconds = maxi(1, fuse_seconds - 1)
			"fuse_up":
				fuse_seconds = mini(5, fuse_seconds + 1)
		if not can_fire:
			continue
		match a:
			"toggle_aim":
				_set_aim(null if aim != null else CameraMath.new_aim(heading_deg))
			"cancel_aim":
				_set_aim(null)
			"fire_down":
				if aim == null:
					_set_aim(CameraMath.new_aim(heading_deg))
				aim.charging = true
				aim.power = 0.0
			"fire_up":
				if aim != null and aim.charging:
					_fire(aim)
	if aim != null:
		aim = CameraMath.charge_aim(CameraMath.nudge_aim(aim, dx, dy), dt)
		return {"dx": 0.0, "dy": 0.0, "wheel": wheel}
	return {"dx": dx, "dy": dy, "wheel": wheel}


func skip() -> void:
	if enabled:
		_queued.append({"k": "skip"})


## Commands to send now: a move when the heading changes, plus queued one-shots.
func read_cmds() -> Array:
	if not enabled:
		_queued = []
		_last_move = -1
		return []
	var out: Array = []
	var yaw := move_yaw()
	if yaw != _last_move:
		out.append({"k": "move", "yaw": yaw})
		_last_move = yaw
	out.append_array(_queued)
	_queued = []
	return out


## Called when a new turn starts so held keys are sent again to the new critter.
func new_turn() -> void:
	_last_move = -1
	_queued = []
	_set_aim(null)


## Walk heading in wire yaw from the held keys, or -1. Standing still while aiming.
func move_yaw() -> int:
	if aim != null:
		return -1
	var a := axes()
	var dir := CameraMath.move_relative_to_camera(camera_yaw_deg, a.y, a.x)
	if dir == Vector3.ZERO:
		return -1
	var yaw := CameraMath.deg_to_yaw(CameraMath.heading_of(dir))
	return (int(roundf(float(yaw) / float(MOVE_SNAP))) * MOVE_SNAP) % CameraMath.YAW_STEPS


## The fire command for an aim, as sent in `input.cmds`.
func fire_cmd(a: CameraMath.AimState) -> Dictionary:
	var w: Dictionary = WEAPONS[weapon]
	var cmd := {
		"k": "fire",
		"weaponId": w["id"],
		"yaw": a.yaw,
		"pitch": a.pitch_deg,
		"power": int(roundf(a.power)),
	}
	if w["id"] == "fizz-grenade":
		cmd["fuseSeconds"] = fuse_seconds
	return cmd


func _fire(a: CameraMath.AimState) -> void:
	_queued.append(fire_cmd(a))
	_set_aim(null)


func _set_aim(a: CameraMath.AimState) -> void:
	aim = a
	if DisplayServer.get_name() == "headless":
		return
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if a != null else Input.MOUSE_MODE_VISIBLE
