class_name Prompts
extends RefCounted
## Button prompts for hints and the tutorial. Prompts follow the device used last: key names for
## the keyboard, and for a pad a glyph token that PromptLabel draws as the real button glyph of
## that pad family (Xbox, PlayStation or Switch). Plain Labels can use `plain()` to get names.
##
## A glyph token looks like "{pad:xbox:0}": family and pad code.

const TOKEN_START := "{pad:"


static func pad_active() -> bool:
	return GameSettings.active_device == "pad"


static func token(family: String, code: int) -> String:
	return "%s%s:%d}" % [TOKEN_START, family, code]


## What the button for an action is called right now: a key name, or a glyph token.
static func label_for(action_id: String) -> String:
	if pad_active():
		var code := GameSettings.pad_code(GameSettings.active_family, action_id)
		if code == PadMap.NONE:
			return "Unbound"
		return token(GameSettings.active_family, code)
	var key := int(GameSettings.keys.get(action_id, GameSettings.action_def(action_id).get("key", 0)))
	return GameSettings.key_label(key)


## The walk control: WASD (or whatever is bound) or the left stick.
static func walk_label() -> String:
	if pad_active():
		return token(GameSettings.active_family, PadMap.LEFT_STICK)
	var walk := ""
	for id in ["move_forward", "move_left", "move_back", "move_right"]:
		walk += GameSettings.key_label(int(GameSettings.keys.get(id, 0)))
	return walk


## How to aim: "Move the mouse" or "Push the right stick".
static func aim_phrase() -> String:
	if pad_active():
		return "Push " + token(GameSettings.active_family, PadMap.RIGHT_STICK) + " to aim"
	return "Move the mouse to aim"


## The lower-case phrase for the tutorial: "move the mouse" or "push (stick glyph)".
static func aim_move() -> String:
	if pad_active():
		return "push " + token(GameSettings.active_family, PadMap.RIGHT_STICK)
	return "move the mouse"


## Split text into segments: {"text": String} or {"family": String, "code": int}.
static func parse(text: String) -> Array:
	var out: Array = []
	var rest := text
	while true:
		var at := rest.find(TOKEN_START)
		if at < 0:
			break
		var end := rest.find("}", at)
		if end < 0:
			break
		var parts := rest.substr(at + TOKEN_START.length(), end - at - TOKEN_START.length()).split(":")
		if parts.size() != 2 or not parts[1].is_valid_int():
			break
		if at > 0:
			out.append({"text": rest.substr(0, at)})
		out.append({"family": parts[0], "code": int(parts[1])})
		rest = rest.substr(end + 1)
	if rest != "":
		out.append({"text": rest})
	return out


## The text with every glyph token replaced by the button's name ("A", "Cross", "RT").
static func plain(text: String) -> String:
	var out := ""
	for seg: Dictionary in parse(text):
		if seg.has("text"):
			out += str(seg["text"])
		else:
			out += PadMap.button_name(str(seg["family"]), int(seg["code"]))
	return out
