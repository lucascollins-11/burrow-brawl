extends Node
## Autoload (name: PadInput). Watches which device the player used last, keyboard and mouse or a
## game pad, so button prompts can switch to that device's names and glyphs, and tracks pads being
## plugged in and out. The family of the pad in use (Xbox, PlayStation, Switch) decides which
## bindings are live. The logic lives in GameSettings and PadMap so tests can use it without a scene.

## The last-used device or pad family changed: prompts should be redrawn.
signal device_changed
## A pad was connected or disconnected.
signal pads_changed(device: int, connected: bool)

## Mouse motion smaller than this many pixels does not count as using the mouse.
const MOUSE_MOVE_MIN := 4.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Input.joy_connection_changed.connect(_on_joy_connection_changed)
	# A pad that is already plugged in sets the family, but the keyboard stays the first device.
	var pads := Input.get_connected_joypads()
	if not pads.is_empty():
		GameSettings.active_family = PadMap.family_for_name(Input.get_joy_name(pads[0]))
		GameSettings.apply_bindings()


func _input(ev: InputEvent) -> void:
	if ev is InputEventKey and (ev as InputEventKey).pressed:
		use("keyboard")
	elif ev is InputEventMouseButton and (ev as InputEventMouseButton).pressed:
		use("keyboard")
	elif ev is InputEventMouseMotion and (ev as InputEventMouseMotion).relative.length() >= MOUSE_MOVE_MIN:
		use("keyboard")
	elif PadMap.is_pad_input(ev):
		use("pad", PadMap.family_for_name(Input.get_joy_name(ev.device)))


## Switch the prompts to a device ("keyboard" or "pad", with the pad's family).
func use(device: String, family := "") -> void:
	if GameSettings.set_active_device(device, family):
		device_changed.emit()


func _on_joy_connection_changed(device: int, connected: bool) -> void:
	if connected:
		# Plugging a pad in makes it the active family at once, so the Settings tab and bindings
		# match it before its first button press.
		var family := PadMap.family_for_name(Input.get_joy_name(device))
		if family != GameSettings.active_family:
			GameSettings.active_family = family
			GameSettings.apply_bindings()
	elif Input.get_connected_joypads().is_empty() and GameSettings.active_device == "pad":
		# The last pad left: fall back to keyboard prompts.
		use("keyboard")
	pads_changed.emit(device, connected)
	device_changed.emit()
