class_name ShotViews
extends Node3D
## Projectiles in flight: one little toy model per weapon (see ShotModels) with a trail.
## Synced from a ViewModel snapshot every frame; a missing id means the shot is gone.

## A shot disappeared; `at` is where it was last seen. The match scene uses it for sea splashes.
signal lost(at: Vector3, weapon: String)

var _nodes: Dictionary = {}  # id -> Node3D (a ShotModels model)


func sync(shots: Array) -> void:
	var seen := {}
	for p in shots:
		var id: int = p["id"]
		seen[id] = true
		var m: Node3D = _nodes.get(id, null)
		if m == null:
			m = _make(str(p["weapon"]))
			_nodes[id] = m
			add_child(m)
		m.position = p["pos"]
		# Tumble in flight; the trail particles stay behind in world space.
		var body := m.get_node_or_null("Body") as Node3D
		if body != null and str(p["weapon"]) != "jelly-mine":
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
