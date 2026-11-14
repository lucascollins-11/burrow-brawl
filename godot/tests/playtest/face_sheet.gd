extends Node3D
## Renders one close-up per Squirmling expression to the folder in the FACE_OUT environment
## variable, then quits. Run under a virtual display like the playtest harness (see
## docs/agent-playtest.md). Each expression is forced through the rig's own calls.

const SHAPES := [
	"idle", "startle", "hurt", "panic", "cheer", "wince", "charging", "gulp", "celebrate", "nod"
]


func _ready() -> void:
	var out := OS.get_environment("FACE_OUT")
	if out == "":
		out = "/tmp/faces"
	DirAccess.make_dir_recursive_absolute(out)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("9ed3f2")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("fff1d6")
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 30, 0)
	add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 28
	add_child(cam)
	cam.current = true
	for k in range(SHAPES.size()):
		var rig := Squirmling.create(0, "hard-hat", Color("e8604c"))
		rig.position = Vector3(float(k) * 12.0, 0, 0)
		rig.set_seed(k + 3)
		add_child(rig)
		rig.set_look_target(Vector3(float(k) * 12.0 + 20.0, 5.0, 30.0))
		var shape: String = SHAPES[k]
		for f in range(70):
			match shape:
				"startle":
					if f == 5:
						rig.startle(Vector3(float(k) * 12.0 - 6, 3, 4))
				"hurt":
					if f == 5:
						rig.hurt()
				"panic":
					if f == 5:
						rig.panic()
				"cheer":
					rig.set_cheer(true)
				"wince":
					if f == 5:
						rig.wince()
				"charging":
					rig.set_charging(true)
				"gulp":
					rig.set("_gulp", 0.4)
				"celebrate":
					if f == 5:
						rig.celebrate()
				"nod":
					if f == 5:
						rig.nod()
			rig.drive(1.0 / 60.0, shape == "charging", Vector3.ZERO, true)
		cam.position = Vector3(float(k) * 12.0 + 1.0, 5.0, 11.0)
		cam.look_at(Vector3(float(k) * 12.0, 4.7, 0.0), Vector3.UP)
		# Let the head settle for the frame that is saved.
		for f in range(2):
			await get_tree().process_frame
		var img := get_viewport().get_texture().get_image()
		img.save_png("%s/%02d-%s.png" % [out, k, shape])
	get_tree().quit()
