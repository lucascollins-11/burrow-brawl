extends TestCase


func test_encode_puts_type_and_fields_in_one_object() -> void:
	var back := Proto.decode(Proto.encode("lobby.ready", {"ready": true, "seq": 3}))
	check_eq(back.get("t"), "lobby.ready", "type")
	check_eq(back.get("ready"), true, "ready flag")
	check_eq(back.get("seq"), 3.0, "seq")


func test_decode_rejects_non_objects_and_bad_type() -> void:
	check_eq(Proto.decode("[1,2]").is_empty(), true, "array is not a message")
	check_eq(Proto.decode("not json").is_empty(), true, "garbage is not a message")
	check_eq(Proto.decode('{"x":1}').is_empty(), true, "missing t")
	check_eq(Proto.decode('{"t":5}').is_empty(), true, "t must be a string")
	check_eq(Proto.decode('{"t":"ok"}').get("t"), "ok", "valid frame")


func test_normalize_code_uses_the_room_alphabet() -> void:
	check_eq(Proto.normalize_code(" k7qx2 "), "K7QX2", "trimmed and upper-cased")
	check_eq(Proto.normalize_code("K7QO2"), "", "O is not in the alphabet")
	check_eq(Proto.normalize_code("K7QX1"), "", "1 is not in the alphabet")
	check_eq(Proto.normalize_code("K7Q"), "", "too short")


func test_hello_carries_a_resume_token_only_when_there_is_one() -> void:
	var first := Proto.hello_fields("tok", "")
	check_eq(first.has("resumeToken"), false, "no resume token on a first hello")
	check_eq(first.get("view"), true, "view client flag")
	check_eq(first.get("protocolVersion"), Proto.PROTOCOL_VERSION, "protocol version")
	check_eq(
		Proto.hello_fields("tok", "res").get("resumeToken"), "res", "resume token sent on reconnect"
	)


func test_valid_nickname_length_limits() -> void:
	check_eq(Proto.valid_nickname("A"), "", "one character is too short")
	check_eq(Proto.valid_nickname("  Al "), "Al", "trimmed")
	check_eq(Proto.valid_nickname("abcdefghijklmnop"), "abcdefghijklmnop", "16 is allowed")
	check_eq(Proto.valid_nickname("abcdefghijklmnopq"), "", "17 is too long")
