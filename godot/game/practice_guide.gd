class_name PracticeGuide
extends RefCounted
## The guided tutorial of a practice match: one thing to try at a time, ticked off when the player
## has done it. It only watches what the match already shows (the snapshot, the aim, the events),
## so it cannot change the rules. `feed` each frame, then read `text()` and `highlight()`.

const WALK_DISTANCE := 3.0

## What each step asks for. {walk}, {jump}, {aim}, {fire}, {weapon_menu} are replaced with the
## player's bound keys.
const STEPS: Array[String] = [
	"Walk around with {walk}.",
	"Jump with {jump}.",
	"Press {aim} to aim, then move the mouse.",
	"Hold {fire} to charge the shot, and let go to fire.",
	"Hit a target dummy. They never shoot back.",
	"Open the weapon menu with {weapon_menu} and pick a different weapon.",
	"Look at the wind gauge in the top left, then fire into the wind.",
	"Open the weapons ({weapon_menu}), pick the Soda Jetpack or Rope Claw, and use it.",
	"Crates drop between turns. Walk into one to take it.",
	"Knock a target dummy into the soda sea.",
]
## The HUD element to spotlight for each step, or "" for none. Names are read by Hud.highlight_target.
const HIGHLIGHTS: Array[String] = ["", "", "", "", "", "weapons", "wind", "weapons", "", ""]
const DONE := "Tutorial complete. You know the basics now. Keep fighting the dummies, or leave from the pause menu."

var step := 0
var _start: Variant = null
var _first_weapon := ""


func finished() -> bool:
	return step >= STEPS.size()


## The HUD element to spotlight now, or "" when there is nothing to point at.
func highlight() -> String:
	if finished():
		return ""
	return HIGHLIGHTS[step]


## `v` is the ViewModel snapshot, `aiming` whether the aim is up, `events` this frame's sim events,
## `weapon_id` the weapon selected now. Steps only move forward on the player's own turn.
func feed(v: Dictionary, aiming: bool, events: Array, weapon_id: String) -> void:
	if finished():
		return
	if _first_weapon == "":
		_first_weapon = weapon_id
	var mine := _active_of_mine(v)
	var my_id := int(mine.get("id", -1))
	match step:
		0:
			if not mine.is_empty():
				var at: Vector3 = mine["pos"]
				if _start == null:
					_start = at
				elif Vector2(at.x - _start.x, at.z - _start.z).length() >= WALK_DISTANCE:
					step += 1
		1:
			for e in events:
				if str(e.get("type", "")) == "jumped" and int(e.get("critterId", -1)) == my_id and my_id >= 0:
					step += 1
					break
		2:
			if aiming and not mine.is_empty():
				step += 1
		3:
			if _fired_by_us(v, events):
				step += 1
		4:
			for e in events:
				if str(e.get("type", "")) != "damage":
					continue
				var team := _team_of(v, int(e.get("critterId", -1)))
				if team >= 0 and not (team in _local(v)):
					step += 1
					break
		5:
			if weapon_id != "" and weapon_id != _first_weapon:
				step += 1
		6:
			if _fired_by_us(v, events):
				step += 1
		7:
			# A utility is on while the snapshot shows the jetpack or the rope under way.
			if str(mine.get("act", "")) in ["jetpack", "rope"]:
				step += 1
		8:
			for e in events:
				if str(e.get("type", "")) == "crateTaken" and _team_of(v, int(e.get("critterId", -1))) in _local(v):
					step += 1
					break
		9:
			for e in events:
				if str(e.get("type", "")) != "died" or str(e.get("cause", "")) != "water":
					continue
				var team := _team_of(v, int(e.get("critterId", -1)))
				if team >= 0 and not (team in _local(v)):
					step += 1
					break


## The prompt to show, with the player's own keys filled in from `keys`.
func text(keys: Dictionary = {}) -> String:
	if finished():
		return DONE
	var line := STEPS[step]
	for k: String in ["walk", "jump", "aim", "fire", "weapon_menu"]:
		line = line.replace("{%s}" % k, str(keys.get(k, k)))
	return "Practice %d of %d: %s" % [step + 1, STEPS.size(), line]


func _fired_by_us(v: Dictionary, events: Array) -> bool:
	for e in events:
		if str(e.get("type", "")) == "fired" and _team_of(v, int(e.get("critterId", -1))) in _local(v):
			return true
	return false


static func _local(v: Dictionary) -> Array:
	return v.get("local_teams", [])


static func _team_of(v: Dictionary, critter_id: int) -> int:
	for c in v.get("critters", []):
		if int(c["id"]) == critter_id:
			return int(c["team"])
	return -1


## The active critter when it is this player's turn, else {}.
static func _active_of_mine(v: Dictionary) -> Dictionary:
	if not bool(v.get("my_turn", false)):
		return {}
	var id: Variant = v.get("active_critter_id", null)
	if id == null:
		return {}
	for c in v.get("critters", []):
		if int(c["id"]) == int(id):
			return c
	return {}
