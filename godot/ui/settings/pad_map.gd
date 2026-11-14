class_name PadMap
extends RefCounted
## Game pad layouts for the three families we support: Xbox, PlayStation and Switch Pro. Godot
## reports every pad through the same positional buttons (the bottom face button is always
## JOY_BUTTON_A, whatever is printed on it), so one set of codes covers all three and only the
## names and glyphs differ.
##
## A pad "code" is an int: 0..30 is a JoyButton, 100 + axis is a trigger pulled past halfway
## (104 left, 105 right), and the two stick codes are display only (movement and look are fixed).

const XBOX := "xbox"
const PLAYSTATION := "playstation"
const SWITCH := "switch"
const FAMILIES: Array[String] = [XBOX, PLAYSTATION, SWITCH]
const FAMILY_NAMES := {XBOX: "Xbox", PLAYSTATION: "PlayStation", SWITCH: "Switch Pro"}

const TRIGGER_BASE := 100
const TRIGGER_LEFT := 104  # TRIGGER_BASE + JOY_AXIS_TRIGGER_LEFT
const TRIGGER_RIGHT := 105  # TRIGGER_BASE + JOY_AXIS_TRIGGER_RIGHT
const LEFT_STICK := 200
const RIGHT_STICK := 201
const NONE := -1

## action id -> default pad code. Walking (left stick) and looking (right stick) are not listed:
## they are fixed. Cancelling an aim shares its button with nothing else that matters while aiming.
const DEFAULTS := {
	"jump": JOY_BUTTON_A,
	"backflip": JOY_BUTTON_B,
	"toggle_aim": JOY_BUTTON_X,
	"fire": TRIGGER_RIGHT,
	"trigger": JOY_BUTTON_Y,
	"weapon_menu": JOY_BUTTON_RIGHT_SHOULDER,
	"cancel_aim": JOY_BUTTON_LEFT_SHOULDER,
	"weapon_1": JOY_BUTTON_DPAD_LEFT,
	"weapon_2": JOY_BUTTON_DPAD_RIGHT,
	"fuse_down": JOY_BUTTON_DPAD_DOWN,
	"fuse_up": JOY_BUTTON_DPAD_UP,
	"skip": JOY_BUTTON_BACK,
	"skip_follow": JOY_BUTTON_RIGHT_STICK,
	"pause": JOY_BUTTON_START,
	"move_forward": NONE,
	"move_back": NONE,
	"move_left": NONE,
	"move_right": NONE,
}

## Codes a player may bind, in the order the rebind menu would list them.
const BINDABLE: Array[int] = [
	JOY_BUTTON_A, JOY_BUTTON_B, JOY_BUTTON_X, JOY_BUTTON_Y,
	JOY_BUTTON_LEFT_SHOULDER, JOY_BUTTON_RIGHT_SHOULDER, TRIGGER_LEFT, TRIGGER_RIGHT,
	JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_LEFT, JOY_BUTTON_DPAD_RIGHT,
	JOY_BUTTON_LEFT_STICK, JOY_BUTTON_RIGHT_STICK, JOY_BUTTON_BACK, JOY_BUTTON_START,
]

## Left stick directions that stand in for the walk keys, as [action id, axis, direction].
const WALK_AXES: Array = [
	["move_forward", JOY_AXIS_LEFT_Y, -1.0],
	["move_back", JOY_AXIS_LEFT_Y, 1.0],
	["move_left", JOY_AXIS_LEFT_X, -1.0],
	["move_right", JOY_AXIS_LEFT_X, 1.0],
]


## Which family a pad belongs to, from the name the OS gives it. Unknown pads count as Xbox, the
## most common layout.
static func family_for_name(joy_name: String) -> String:
	var n := joy_name.to_lower()
	for word in ["playstation", "dualshock", "dualsense", "ps3", "ps4", "ps5", "sony", "wireless controller"]:
		if n.contains(word):
			return PLAYSTATION
	for word in ["nintendo", "switch", "pro controller", "joy-con", "joycon"]:
		if n.contains(word):
			return SWITCH
	return XBOX


## Names of the connected pads with each one's family, e.g. "Xbox Wireless Controller (Xbox)".
static func connected_summary() -> PackedStringArray:
	var out: PackedStringArray = []
	for id in Input.get_connected_joypads():
		var joy_name := Input.get_joy_name(id)
		out.append("%s (%s)" % [joy_name, FAMILY_NAMES[family_for_name(joy_name)]])
	return out


static func default_codes() -> Dictionary:
	return DEFAULTS.duplicate()


static func is_trigger(code: int) -> bool:
	return code == TRIGGER_LEFT or code == TRIGGER_RIGHT


## The InputMap event for a code, or null for NONE and the display-only stick codes.
static func event_for(code: int) -> InputEvent:
	if is_trigger(code):
		var m := InputEventJoypadMotion.new()
		m.axis = (code - TRIGGER_BASE) as JoyAxis
		m.axis_value = 1.0
		return m
	if code >= 0 and code < 100:
		var b := InputEventJoypadButton.new()
		b.button_index = code as JoyButton
		return b
	return null


## The code a pressed pad event stands for, or NONE: a button press, or a trigger pulled past
## halfway. Sticks and releases give NONE.
static func code_for_event(ev: InputEvent) -> int:
	if ev is InputEventJoypadButton:
		var b := ev as InputEventJoypadButton
		return int(b.button_index) if b.pressed and int(b.button_index) < 100 else NONE
	if ev is InputEventJoypadMotion:
		var m := ev as InputEventJoypadMotion
		var axis := int(m.axis)
		if (axis == JOY_AXIS_TRIGGER_LEFT or axis == JOY_AXIS_TRIGGER_RIGHT) and m.axis_value > 0.6:
			return TRIGGER_BASE + axis
	return NONE


## True for an event from a pad, whether or not it is a bindable press (a stick drifting a hair
## does not count, so it cannot steal the prompts from the keyboard).
static func is_pad_input(ev: InputEvent) -> bool:
	if ev is InputEventJoypadButton:
		return (ev as InputEventJoypadButton).pressed
	if ev is InputEventJoypadMotion:
		return absf((ev as InputEventJoypadMotion).axis_value) > 0.5
	return false


## What the button is called on the pad, e.g. "A" or "Cross" or "RT". Used for text and tests.
static func button_name(family: String, code: int) -> String:
	match code:
		JOY_BUTTON_A:
			return {XBOX: "A", PLAYSTATION: "Cross", SWITCH: "B"}[family]
		JOY_BUTTON_B:
			return {XBOX: "B", PLAYSTATION: "Circle", SWITCH: "A"}[family]
		JOY_BUTTON_X:
			return {XBOX: "X", PLAYSTATION: "Square", SWITCH: "Y"}[family]
		JOY_BUTTON_Y:
			return {XBOX: "Y", PLAYSTATION: "Triangle", SWITCH: "X"}[family]
		JOY_BUTTON_LEFT_SHOULDER:
			return {XBOX: "LB", PLAYSTATION: "L1", SWITCH: "L"}[family]
		JOY_BUTTON_RIGHT_SHOULDER:
			return {XBOX: "RB", PLAYSTATION: "R1", SWITCH: "R"}[family]
		TRIGGER_LEFT:
			return {XBOX: "LT", PLAYSTATION: "L2", SWITCH: "ZL"}[family]
		TRIGGER_RIGHT:
			return {XBOX: "RT", PLAYSTATION: "R2", SWITCH: "ZR"}[family]
		JOY_BUTTON_BACK:
			return {XBOX: "View", PLAYSTATION: "Share", SWITCH: "Minus"}[family]
		JOY_BUTTON_START:
			return {XBOX: "Menu", PLAYSTATION: "Options", SWITCH: "Plus"}[family]
		JOY_BUTTON_LEFT_STICK:
			return {XBOX: "LS click", PLAYSTATION: "L3", SWITCH: "L stick click"}[family]
		JOY_BUTTON_RIGHT_STICK:
			return {XBOX: "RS click", PLAYSTATION: "R3", SWITCH: "R stick click"}[family]
		JOY_BUTTON_DPAD_UP:
			return "D-pad up"
		JOY_BUTTON_DPAD_DOWN:
			return "D-pad down"
		JOY_BUTTON_DPAD_LEFT:
			return "D-pad left"
		JOY_BUTTON_DPAD_RIGHT:
			return "D-pad right"
		LEFT_STICK:
			return "Left stick"
		RIGHT_STICK:
			return "Right stick"
		NONE:
			return "Unbound"
	return "Button %d" % code
