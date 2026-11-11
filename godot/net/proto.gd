## Wire helpers. Mirrors shared/src/net/protocol.ts (protocol v3, docs/protocol.md section 4).
## Every frame is one JSON object with a "t" field.
class_name Proto
extends RefCounted

const PROTOCOL_VERSION := 3
const ROOM_CODE_ALPHABET := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const ROOM_CODE_LENGTH := 5
const NICKNAME_MIN := 2
const NICKNAME_MAX := 16
const MIN_TEAMS := 2
const MAX_TEAMS := 8


static func encode(msg_type: String, fields: Dictionary = {}) -> String:
	var msg: Dictionary = fields.duplicate()
	msg["t"] = msg_type
	return JSON.stringify(msg)


## Parse one frame. Returns {} when the frame is not a JSON object with a string "t".
static func decode(text: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	var msg: Dictionary = parsed
	if typeof(msg.get("t", null)) != TYPE_STRING:
		return {}
	return msg


## Trimmed nickname, or "" when it is outside 2 to 16 characters.
static func valid_nickname(raw: String) -> String:
	var s := raw.strip_edges()
	if s.length() < NICKNAME_MIN or s.length() > NICKNAME_MAX:
		return ""
	return s


## Upper-cased room code, or "" when it is the wrong length or has a character outside the alphabet.
static func normalize_code(raw: String) -> String:
	var code := raw.strip_edges().to_upper()
	if code.length() != ROOM_CODE_LENGTH:
		return ""
	for i in range(code.length()):
		if ROOM_CODE_ALPHABET.find(code[i]) < 0:
			return ""
	return code
