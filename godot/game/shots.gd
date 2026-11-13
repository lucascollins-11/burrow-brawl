class_name ShotViews
extends Node3D
## Placeholder meshes for projectiles in flight: acorn = brown sphere, fizz grenade = blue sphere.
## Synced from a ViewModel snapshot every frame; a missing id means the shot is gone.

## A shot disappeared; `at` is where it was last seen. The match scene uses it for sea splashes.
signal lost(at: Vector3, weapon: String)

var _nodes: Dictionary = {}  # id -> MeshInstance3D


func sync(shots: Array) -> void:
	var seen := {}
	for p in shots:
		var id: int = p["id"]
		seen[id] = true
		var m: MeshInstance3D = _nodes.get(id, null)
		if m == null:
			m = _make(str(p["weapon"]))
			_nodes[id] = m
			add_child(m)
		m.position = p["pos"]
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


func _make(weapon: String) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	var grenade := weapon == "fizz-grenade"
	s.radius = 0.8 if grenade else 0.9
	s.height = s.radius * 2.0
	m.mesh = s
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("4aa3df") if grenade else Color("8b5a2b")
	mat.roughness = 0.6
	m.material_override = mat
	m.set_meta("weapon", weapon)
	return m
