extends Node
## Autoload (name: Prefs). Loads and applies the saved settings once at start-up; the logic lives in
## GameSettings so tests can use it without a scene.


func _ready() -> void:
	GameSettings.boot()
