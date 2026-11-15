## Headless test runner.
## Run: godot --headless --path godot -s res://tests/run_tests.gd
## Exits 0 when every test passes, 1 otherwise.
extends SceneTree

const SUITES := [
	"res://tests/test_proto.gd",
	"res://tests/test_lobby_state.gd",
	"res://tests/test_config.gd",
	"res://tests/test_hud_layout.gd",
	"res://tests/test_hats.gd",
	"res://tests/test_critter_smoother.gd",
	"res://tests/test_squirmling_look.gd",
	"res://tests/test_critter_names.gd",
	"res://tests/test_aim_guide.gd",
	"res://tests/test_pad_input.gd",
	"res://tests/test_game_math.gd",
	"res://tests/test_audio.gd",
	"res://tests/test_effects.gd",
	"res://tests/test_shot_models.gd",
	"res://tests/test_gear_fx.gd",
	"res://tests/test_settings.gd",
	"res://tests/test_weapon_grid.gd",
	"res://tests/test_how_to_play.gd",
	"res://tests/test_storybook_style.gd",
	"res://tests/test_scenery.gd",
	"res://tests/test_weather.gd",
]


var _ran := false


## The tests run on the first frame, not in `_initialize`: the root window only joins the tree
## after that, and tests that add nodes (effects, particles, timers) need `get_tree()` to work.
func _initialize() -> void:
	TestCase.tree = self


func _process(_delta: float) -> bool:
	if _ran:
		return false
	_ran = true
	_run()
	return true


func _run() -> void:
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
