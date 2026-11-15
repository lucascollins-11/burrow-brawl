extends Node3D
## Concept renders of a smooth, seamless Squirmling body (a swept tube along the slither spine, a
## bulbous head and a tapering tail) next to the current stacked-ring version. Run under a virtual
## display like face_sheet.tscn; writes PNGs to the folder in SMOOTH_OUT. Not used by the game.

const TEAM := Color("e8604c")
const CREAM := Color("f3e3c3")

var _out := "/tmp/smooth"


func _ready() -> void:
	var o := OS.get_environment("SMOOTH_OUT")
	if o != "":
		_out = o
	DirAccess.make_dir_recursive_absolute(_out)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("a9d9f2")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("fff1d6")
	env.ambient_light_energy = 0.75
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, 40, 0)
	sun.shadow_enabled = true
	add_child(sun)
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(120, 60)
	floor_mesh.mesh = plane
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color("f1cf6a")
	fm.roughness = 1.0
	floor_mesh.material_override = fm
	add_child(floor_mesh)
	var cam := Camera3D.new()
	cam.fov = 30
	add_child(cam)
	cam.current = true

	# 1. idle, side view
	var idle := _smooth("", 0.0, 0.0)
	add_child(idle)
	await _shot(cam, Vector3(0, 3.2, 0), Vector3(11, 6.0, 9), "01-idle")
	idle.queue_free()
	# 2. slithering: the wave in the spine, a mid-stride pose
	var slide := _smooth("", 1.0, 1.4)
	add_child(slide)
	await _shot(cam, Vector3(0, 2.6, 0), Vector3(12, 5.0, 8), "02-slither")
	slide.queue_free()
	# 3. with a hat, three-quarter and closer
	var hat := _smooth("hard-hat", 0.0, 0.0)
	add_child(hat)
	await _shot(cam, Vector3(0, 3.0, -0.6), Vector3(11, 5.2, 7), "03-hat")
	hat.queue_free()
	# 4. side by side: the stacked-ring body we have now, and the smooth one
	var rings := Squirmling.create(0, "hard-hat", TEAM)
	rings.position = Vector3(-4.2, 0, 0)
	for f in range(90):
		rings.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	add_child(rings)
	var smooth := _smooth("hard-hat", 0.0, 0.0)
	smooth.position = Vector3(4.2, 0, 0)
	add_child(smooth)
	await _shot(cam, Vector3(0, 2.8, 0), Vector3(7, 5.5, 24), "04-side-by-side")
	rings.queue_free()
	smooth.queue_free()
	# 5. face close-up, front and three-quarter
	var face := _smooth("", 0.0, 0.0)
	add_child(face)
	await _shot(cam, Vector3(0, 5.0, 1.0), Vector3(0, 6.2, 12), "05-face-front")
	await _shot(cam, Vector3(0, 5.0, 1.0), Vector3(7, 6.0, 10), "06-face-three-quarter")
	face.queue_free()
	var hatted := _smooth("hard-hat", 0.0, 0.0)
	add_child(hatted)
	await _shot(cam, Vector3(0, 5.2, 1.0), Vector3(0, 6.4, 12), "07-face-hat")
	get_tree().quit()


func _shot(cam: Camera3D, target: Vector3, from: Vector3, name: String) -> void:
	cam.position = from
	cam.look_at(target, Vector3.UP)
	for f in range(3):
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [_out, name])


## A real Squirmling (smooth skinned body) at the origin, driven for a while.
func _smooth(hat_style: String, wave: float, phase: float) -> Node3D:
	var w := Squirmling.create(0, hat_style, TEAM)
	for f in range(int(60 + phase * 40)):
		w.drive(1.0 / 60.0, wave > 0.0, Vector3(0, 0, 7.0 * wave), true)
	return w


func _flat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 1.0
	return m
