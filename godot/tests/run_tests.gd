## Headless test runner.
## Run: godot --headless --path godot -s res://tests/run_tests.gd
## Exits 0 when every test passes, 1 otherwise.
extends SceneTree

const SUITES := [
	"res://tests/test_proto.gd",
	"res://tests/test_lobby_state.gd",
	"res://tests/test_config.gd",
]


func _init() -> void:
	var total := 0
	var failed := 0
	for path in SUITES:
		var suite_script: Script = load(path)
		if suite_script == null:
			failed += 1
			print("FAIL cannot load " + path)
			continue
		var suite: TestCase = suite_script.new()
		for method in suite.get_method_list():
			var method_name: String = method["name"]
			if not method_name.begins_with("test_"):
				continue
			total += 1
			suite.failures.clear()
			suite.call(method_name)
			if suite.failures.is_empty():
				print("PASS %s::%s" % [path.get_file(), method_name])
			else:
				failed += 1
				print("FAIL %s::%s" % [path.get_file(), method_name])
				for message in suite.failures:
					print("     " + message)
	if total == 0:
		failed += 1
		print("FAIL no tests ran")
	print("%d tests, %d failed" % [total, failed])
	quit(1 if failed > 0 else 0)
