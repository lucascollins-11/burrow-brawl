## Assertion helper for the headless runner. Suites extend this and define test_* methods.
class_name TestCase
extends RefCounted

## The scene tree the runner runs in, for tests that need nodes in the tree.
static var tree: SceneTree = null

var failures: Array[String] = []


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func check_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual != expected:
		failures.append("%s: expected %s, got %s" % [message, str(expected), str(actual)])
