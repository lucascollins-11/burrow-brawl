class_name ShotViews
extends Node3D
## Projectiles in flight: one little toy model per weapon (see ShotModels) with a trail.
## Synced from a ViewModel snapshot every frame; a missing id means the shot is gone.

## A shot disappeared; `at` is where it was last seen. The match scene uses it for sea splashes.
signal lost(at: Vector3, weapon: String)

var _nodes: Dictionary = {}  # id -> Node3D (a ShotModels model)


## `mines` are placed Jelly Mines ({id, weapon, pos, armed, triggered}); they get a model like a
## shot and blink: dim while arming, a slow pulse when armed, a fast flash once set off.
func sync(shots: Array, mines := []) -> void:
	var seen := {}
	var all: Array = []
	for p in shots:
		all.append(p)
	for m in mines:
		# Mine ids and shot ids are separate counters; keep them apart in the table.
		var q: Dictionary = (m as Dictionary).duplicate()
		q["id"] = -1 - int(m["id"])
		all.append(q)
	var now := float(Time.get_ticks_msec()) / 1000.0
	for p in all:
		var id: int = p["id"]
		seen[id] = true
		var m: Node3D = _nodes.get(id, null)
		if m == null:
			m = _make(str(p["weapon"]))
			_nodes[id] = m
			add_child(m)
		var before := m.position
		m.position = p["pos"]
		var weapon := str(p["weapon"])
		if ShotModels.STEERED.has(weapon):
			# Face the way it travels and move its limbs; the speed comes from how far it went.
			if p.has("heading_deg") and float(p["heading_deg"]) != INF:
				m.rotation.y = deg_to_rad(float(p["heading_deg"]))
			ShotModels.animate(m, weapon, now, before.distance_to(m.position) * 60.0)
		if p.has("armed"):
			ShotModels.blink_mine(m, now, bool(p["armed"]), bool(p.get("triggered", false)))
		# Tumble in flight; the trail particles stay behind in world space.
		var body := m.get_node_or_null("Body") as Node3D
		if body != null and str(p["weapon"]) != "jelly-mine" and not ShotModels.STEERED.has(str(p["weapon"])):
			var t := float(Time.get_ticks_msec()) / 1000.0
			body.rotation = Vector3(t * 3.1 + float(id), t * 4.3, t * 2.2)
	for id in _nodes.keys():
		if not seen.has(id):
			var gone: Node3D = _nodes[id]
			lost.emit(gone.position, str(gone.get_meta("weapon", "")))
			gone.queue_free()
			_nodes.erase(id)


func clear() -> void:
	for id in _nodes.keys():
		(_nodes[id] as Node).queue_free()
	_nodes.clear()


func _make(weapon: String) -> Node3D:
	return ShotModels.make(weapon)
