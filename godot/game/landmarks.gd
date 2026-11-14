## Big set pieces around the island: little village islets on the horizon (castles, churches,
## windmills, towers, taverns, homes, trees, piers) and ships riding the sea. All of them are
## free library models (godot/assets/thirdparty, see CREDITS.md) in the Storybook restyle.
##
## They stand outside the play area on purpose. Anything on the island itself has to be part of
## the destructible terrain so shots hit it, which is the map generator's job; these only frame
## the island and give the horizon depth.
##
##   landmarks.setup(theme_id, size_x, size_z, sea_y, seed, density)
class_name Landmarks
extends Node3D

const Style := preload("res://assets/storybook_style.gd")
const Toon := preload("res://game/toon.gd")
const KAYKIT := "res://assets/thirdparty/kaykit/medieval_hexagon/"
const POLYHAVEN := "res://assets/thirdparty/polyhaven/%s/%s.gltf"
## KayKit models are about one unit per hex: this many world units per KayKit unit (a home is
## then about 9 tall, a castle about 40; a Squirmling is 6).
const KAYKIT_SCALE := 10.0

## The big building in the middle of each islet, by theme set; homes and trees go around it.
const HEROES := {
	"garden": ["castle", "church", "windmill", "watermill", "tavern", "tower_B", "market"],
	"toy": ["castle", "tower_A", "tower_B", "barracks", "market", "archeryrange", "tavern"],
	"bath": ["watermill", "church", "tavern", "well", "windmill", "market"],
	"candy": ["church", "market", "tavern", "windmill", "castle", "tower_A"],
	"brass": ["lumbermill", "blacksmith", "mine", "tower_catapult", "watermill", "windmill", "barracks"],
}
## KayKit colour per theme set (its buildings come in blue, red and yellow roofs).
const ROOF := {"garden": "blue", "toy": "red", "bath": "blue", "candy": "yellow", "brass": "red"}
const HOMES := ["home_A", "home_B", "home_A", "home_B", "well", "tavern"]
const NATURE := [
	"tree_single_A", "tree_single_B", "tree_single_A", "tree_single_B", "rock_single_A",
	"rock_single_C", "rock_single_E", "hill_single_A",
]
## Ships, with their height in world units.
const SHIPS := [["dutch_ship_medium", 34.0], ["ship_pinnace", 22.0], ["dutch_ship_medium", 30.0]]

var islets: Array = []  # [{pos: Vector3, radius: float, hero: String}]
var ships: Array[Node3D] = []
var _sea_y := 0.0
var _clock := 0.0
var _rng := RandomNumberGenerator.new()
var _look: Dictionary = {}


func setup(theme: String, size_x: float, size_z: float, sea: float, seed_value: int, density := 1.0) -> void:
	clear()
	_sea_y = sea
	_rng.seed = seed_value ^ 0x51ab
	_look = MapLook.for_theme(theme)
	var set_id: String = Scenery.THEME_SET.get(theme, "garden")
	var centre := Vector3(size_x * 0.5, sea, size_z * 0.5)
	var reach := Vector2(size_x, size_z).length() * 0.5
	var count := clampi(int(round(6.0 * density)), 3, 8)
	var heroes: Array = (HEROES[set_id] as Array).duplicate()
	var start := _rng.randf() * TAU
	for i in count:
		var angle := start + TAU * float(i) / float(count) + _rng.randf_range(-0.25, 0.25)
		var dist := reach + _rng.randf_range(42.0, 90.0)
		var at := centre + Vector3(cos(angle), 0.0, sin(angle)) * dist
		var hero: String = heroes[i % heroes.size()]
		_islet(at, _rng.randf_range(24.0, 36.0), hero, str(ROOF[set_id]), angle)
	var ship_count := clampi(int(round(3.0 * density)), 1, 3)
	for i in ship_count:
		var angle := start + TAU * (float(i) + 0.5) / float(ship_count) + _rng.randf_range(-0.2, 0.2)
		var dist := reach + _rng.randf_range(16.0, 30.0)
		var at := centre + Vector3(cos(angle), 0.0, sin(angle)) * dist
		_ship(SHIPS[i % SHIPS.size()], at, angle)
	set_process(not ships.is_empty())


func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	islets.clear()
	ships.clear()


func _process(delta: float) -> void:
	_clock += delta
	for i in ships.size():
		var s := ships[i]
		var base: Vector3 = s.get_meta("base")
		var phase := float(i) * 1.7
		s.position.y = base.y + sin(_clock * 0.9 + phase) * 0.35
		s.rotation.z = sin(_clock * 0.7 + phase) * 0.035
		s.rotation.x = sin(_clock * 0.55 + phase * 0.5) * 0.02


## A rounded island in the theme's colours with a little village on top.
func _islet(at: Vector3, radius: float, hero: String, roof: String, facing: float) -> void:
	var root := Node3D.new()
	root.name = "Islet_%s" % hero
	root.position = at
	add_child(root)
	var top := 5.0 + _rng.randf_range(0.0, 4.0)
	_disc(root, radius * 1.18, radius * 1.3, 2.4, -1.6, MapLook.color(_look, "sand"))
	_disc(root, radius * 0.95, radius * 1.12, top + 2.0, -2.0, MapLook.color(_look, "rock"))
	_disc(root, radius * 0.9, radius * 0.95, 1.0, top, MapLook.color(_look, "grass"))
	var ground := top + 1.0
	_kaykit(root, "buildings/%s/building_%s_%s.gltf" % [roof, hero, roof], Vector3(0, ground, 0), _rng.randf() * TAU)
	var homes := _rng.randi_range(3, 5)
	for i in homes:
		var a := TAU * float(i) / float(homes) + _rng.randf_range(-0.3, 0.3)
		var r := radius * _rng.randf_range(0.5, 0.72)
		var kind: String = HOMES[_rng.randi() % HOMES.size()]
		_kaykit(root, "buildings/%s/building_%s_%s.gltf" % [roof, kind, roof], Vector3(cos(a) * r, ground, sin(a) * r), a + PI)
	for i in _rng.randi_range(5, 9):
		var a := _rng.randf() * TAU
		var r := radius * _rng.randf_range(0.3, 0.85)
		var kind: String = NATURE[_rng.randi() % NATURE.size()]
		_kaykit(root, "decoration/nature/%s.gltf" % kind, Vector3(cos(a) * r, ground, sin(a) * r), _rng.randf() * TAU, _rng.randf_range(0.8, 1.2))
	# A pier on the side that faces the play area, with a buoy off its end.
	var inward := facing + PI
	var pier := Style.instance(POLYHAVEN % ["modular_wooden_pier", "modular_wooden_pier"], {"height": 4.0})
	if pier != null:
		var dir := Vector3(cos(inward), 0, sin(inward))
		pier.position = dir * radius * 1.15 + Vector3(0, 1.0, 0)
		pier.rotation.y = -inward
		pier.scale *= 1.6
		root.add_child(pier)
		var buoy := Style.instance(POLYHAVEN % ["ocean_buoy", "ocean_buoy"], {"height": 5.0})
		if buoy != null:
			buoy.position = dir * radius * 1.6 + Vector3(0, -1.0, 0)
			root.add_child(buoy)
	islets.append({"pos": at, "radius": radius, "hero": hero})


func _disc(parent: Node3D, top_r: float, bottom_r: float, height: float, y: float, color: Color) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top_r
	mesh.bottom_radius = bottom_r
	mesh.height = height
	mesh.radial_segments = 28
	mesh.rings = 1
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
	mat.albedo_color = color
	mat.roughness = 1.0
	mesh.material = mat
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = Vector3(0, y + height * 0.5, 0)
	parent.add_child(mi)


func _kaykit(parent: Node3D, rel: String, at: Vector3, yaw: float, size := 1.0) -> Node3D:
	var node := Style.instance(KAYKIT + rel, {"flat": false, "saturation": 1.1})
	if node == null:
		return null
	node.scale = Vector3.ONE * KAYKIT_SCALE * size
	node.position = at
	node.rotation.y = yaw
	parent.add_child(node)
	return node


func _ship(pick: Array, at: Vector3, angle: float) -> void:
	var id := str(pick[0])
	# Old photo-scanned hulls average out dark: lift them toward painted storybook wood.
	var node := Style.instance(POLYHAVEN % [id, id], {"height": float(pick[1]), "saturation": 1.35, "tint": Color(1.45, 1.3, 1.15)})
	if node == null:
		return
	var box := Style.bounds(node)
	# Sit the hull a fifth of its height under the water line.
	var base := Vector3(at.x, _sea_y - box.position.y * node.scale.y - box.size.y * node.scale.y * 0.12, at.z)
	node.position = base
	node.set_meta("base", base)
	# Sail along the shore, not straight at it.
	node.rotation.y = -angle + PI * 0.5 + _rng.randf_range(-0.4, 0.4)
	node.name = "Ship_%s" % id
	add_child(node)
	ships.append(node)
