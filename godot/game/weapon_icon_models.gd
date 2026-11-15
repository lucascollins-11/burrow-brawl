class_name WeaponIconModels
extends RefCounted
## A little toy model for every item in the arsenal, built from primitives in the same toon style
## as the in-flight shots (ShotModels). Items that fly as a shot reuse that model; the rest (guns,
## tools, charms, mobility items) are built here. WeaponIcons renders these to the picker's
## pictures, so there is no drawn art. `make()` returns a Node3D centred on the origin, about two
## units across, facing the camera's three-quarter view.

## Catalogue id -> the ShotModels id of the same toy, where the in-flight model has another name.
const SHOT_MODEL := {
	"acorn-mortar": "acorn-mortar",
	"pinecone-popper": "pinecone-popper",
	"fizz-grenade": "fizz-grenade",
	"beehive-strike": "beehive-bomb",
	"lantern-drift": "paper-lantern",
	"toy-block-drop": "giant-block",
	"wind-up-robot": "wind-up-robot",
	"marble-roller": "marble-roller",
	"rc-racer": "rc-racer",
	"kite-bomber": "kite-bomber",
	"jelly-mine": "jelly-mine",
	"mousetrap-snapper": "mousetrap-snapper",
	"boulder-of-doom": "boulder-of-doom",
	"marble-meteor-shower": "meteor-marble",
	"party-pinata": "pinata",
}

## Items built here.
const OWN: Array[String] = [
	"fizz-rocket", "paper-plane-seeker", "slingshot", "gumball-cluster", "snow-globe", "hot-sauce-flask",
	"pepper-shotgun", "pea-gatling", "water-pistol", "root-punch", "spatula-swat", "pillow-bash",
	"glue-puddle", "rope-claw", "spring-boots", "umbrella-glide", "soda-jetpack", "teleport-burrow",
	"drill-hat", "build-block", "feather-charm", "bubble-shield", "cookie-snack", "skip-turn", "tabletop-quake",
]

const CREAM := Color("f6e7c8")
const PINK := Color("ff7fb0")
const ORANGE := Color("ff8a3d")
const PURPLE := Color("9b6fd6")
const TAN := Color("e0b48a")
const STEEL := Color("a9b4c2")
const DARK := Color("3b3f4a")


## True when `id` has a model of its own (otherwise make() gives a plain grey ball).
static func has_model(id: String) -> bool:
	return SHOT_MODEL.has(id) or OWN.has(id)


static func make(id: String) -> Node3D:
	if SHOT_MODEL.has(id):
		var shot := ShotModels.make(str(SHOT_MODEL[id]))
		# Just the toy: the smoke trail belongs to the flight, not the picture.
		for child in shot.get_children():
			if child is CPUParticles3D:
				shot.remove_child(child)
				child.free()
		var body := shot.get_node_or_null("Body") as Node3D
		if body != null:
			body.rotation_degrees = Vector3(18.0, 0.0, 0.0) if _lies_flat(id) else Vector3.ZERO
		return shot
	var root := Node3D.new()
	root.name = "Icon"
	var body := Node3D.new()
	body.name = "Body"
	root.add_child(body)
	match id:
		"fizz-rocket":
			_rocket(body)
		"paper-plane-seeker":
			_paper_plane(body)
		"slingshot":
			_slingshot(body)
		"gumball-cluster":
			_gumballs(body)
		"snow-globe":
			_snow_globe(body)
		"hot-sauce-flask":
			_hot_sauce(body)
		"pepper-shotgun":
			_shotgun(body)
		"pea-gatling":
			_gatling(body)
		"water-pistol":
			_water_pistol(body)
		"root-punch":
			_fist(body)
		"spatula-swat":
			_spatula(body)
		"pillow-bash":
			_pillow(body)
		"glue-puddle":
			_glue(body)
		"rope-claw":
			_claw(body)
		"spring-boots":
			_boot(body)
		"umbrella-glide":
			_umbrella(body)
		"soda-jetpack":
			_jetpack(body)
		"teleport-burrow":
			_burrow(body)
		"drill-hat":
			_drill_hat(body)
		"build-block":
			_blocks(body)
		"feather-charm":
			_feather(body)
		"bubble-shield":
			_bubble(body)
		"cookie-snack":
			_cookie(body)
		"skip-turn":
			_hanky(body)
		"tabletop-quake":
			_table(body)
		_:
			body.add_child(ShotModels._mi(ShotModels._sphere(0.9), ShotModels.GREY))
	return root


## Shot models that are long and low look best tipped toward the camera.
static func _lies_flat(id: String) -> bool:
	return id in ["rc-racer", "marble-roller", "jelly-mine", "mousetrap-snapper", "toy-block-drop"]


# ------------------------------------------------------------------ helpers


static func _m(mesh: Mesh, color: Color, pos := Vector3.ZERO, rot := Vector3.ZERO, scale := Vector3.ONE) -> MeshInstance3D:
	var mi := ShotModels._mi(mesh, color, pos)
	mi.rotation_degrees = rot
	mi.scale = scale
	return mi


static func _glass(mesh: Mesh, color: Color, pos := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.15
	mi.material_override = m
	mi.position = pos
	return mi


static func _box(x: float, y: float, z: float) -> BoxMesh:
	return ShotModels._box(x, y, z)


static func _cyl(top: float, bottom: float, height: float) -> CylinderMesh:
	return ShotModels._cyl(top, bottom, height)


static func _ball(radius: float) -> SphereMesh:
	return ShotModels._sphere(radius)


static func _torus(inner: float, outer: float) -> TorusMesh:
	var t := TorusMesh.new()
	t.inner_radius = inner
	t.outer_radius = outer
	return t


# ------------------------------------------------------------------ the models


static func _rocket(b: Node3D) -> void:
	var rocket := Node3D.new()
	rocket.rotation_degrees = Vector3(0, 0, -38)
	b.add_child(rocket)
	rocket.add_child(_m(_cyl(0.42, 0.42, 1.7), CREAM))
	rocket.add_child(_m(_cyl(0.0, 0.42, 0.8), ShotModels.RED, Vector3(0, 1.2, 0)))
	rocket.add_child(_m(_cyl(0.43, 0.43, 0.22), ShotModels.RED, Vector3(0, -0.35, 0)))
	for i in 3:
		var fin := _m(_box(0.08, 0.6, 0.5), ShotModels.BLUE, Vector3(0, -0.85, 0))
		fin.rotation_degrees.y = i * 60.0
		rocket.add_child(fin)
	rocket.add_child(_m(_cyl(0.0, 0.3, 0.6), ShotModels.YELLOW, Vector3(0, -1.5, 0), Vector3(180, 0, 0)))


static func _paper_plane(b: Node3D) -> void:
	var prism := PrismMesh.new()
	prism.size = Vector3(1.9, 2.6, 0.08)
	b.add_child(_m(prism, ShotModels.WHITE, Vector3(0, 0, 0), Vector3(-90, 0, 0)))
	var fold := PrismMesh.new()
	fold.size = Vector3(0.7, 2.4, 0.5)
	b.add_child(_m(fold, Color("d9e6f2"), Vector3(0, 0.12, 0.05), Vector3(-90, 0, 0)))
	b.rotation_degrees = Vector3(0, -30, 12)


static func _slingshot(b: Node3D) -> void:
	b.add_child(_m(_cyl(0.16, 0.2, 1.3), ShotModels.BROWN, Vector3(0, -0.6, 0)))
	b.add_child(_m(_cyl(0.13, 0.17, 1.1), ShotModels.BROWN, Vector3(-0.38, 0.35, 0), Vector3(0, 0, 28)))
	b.add_child(_m(_cyl(0.13, 0.17, 1.1), ShotModels.BROWN, Vector3(0.38, 0.35, 0), Vector3(0, 0, -28)))
	b.add_child(_m(_cyl(0.05, 0.05, 0.95), ShotModels.RED, Vector3(0, 0.78, 0), Vector3(0, 0, 90)))
	b.add_child(_m(_ball(0.22), ShotModels.GREY, Vector3(0, 0.78, 0.05)))


static func _gumballs(b: Node3D) -> void:
	var colors := [PINK, ShotModels.BLUE, ShotModels.YELLOW, ShotModels.GREEN, ShotModels.RED]
	var spots := [Vector3(-0.5, -0.25, 0), Vector3(0.5, -0.25, 0.1), Vector3(0, 0.5, 0), Vector3(-0.15, -0.1, 0.65), Vector3(0.05, -0.35, -0.55)]
	for i in colors.size():
		b.add_child(_m(_ball(0.52), colors[i], spots[i]))
		b.add_child(_m(_ball(0.1), Color.WHITE, (spots[i] as Vector3) + Vector3(-0.18, 0.28, 0.35)))


static func _snow_globe(b: Node3D) -> void:
	b.add_child(_m(_cyl(0.75, 0.9, 0.5), ShotModels.BROWN, Vector3(0, -1.0, 0)))
	b.add_child(_m(_cyl(0.3, 0.3, 0.35), ShotModels.DARK_BROWN, Vector3(0, -0.6, 0)))
	b.add_child(_m(_cyl(0.0, 0.32, 0.8), ShotModels.GREEN, Vector3(0, -0.3, 0)))
	b.add_child(_m(_cyl(0.0, 0.22, 0.6), ShotModels.GREEN, Vector3(0, 0.12, 0)))
	for p in [Vector3(-0.5, 0.3, 0.2), Vector3(0.45, 0.05, -0.3), Vector3(0.2, 0.5, 0.4), Vector3(-0.3, -0.2, -0.4)]:
		b.add_child(_m(_ball(0.07), Color.WHITE, p))
	b.add_child(_glass(_ball(1.0), Color(0.7, 0.9, 1.0, 0.32), Vector3(0, 0.1, 0)))


static func _hot_sauce(b: Node3D) -> void:
	b.add_child(_m(_ball(0.85), ShotModels.RED, Vector3(0, -0.2, 0), Vector3.ZERO, Vector3(1, 1.05, 1)))
	b.add_child(_m(_cyl(0.2, 0.28, 0.7), ShotModels.RED, Vector3(0, 0.75, 0)))
	b.add_child(_m(_cyl(0.3, 0.3, 0.25), ShotModels.BROWN, Vector3(0, 1.2, 0)))
	b.add_child(_m(_cyl(0.87, 0.87, 0.35), ShotModels.WHITE, Vector3(0, -0.2, 0)))
	b.add_child(_m(_cyl(0.0, 0.2, 0.5), ORANGE, Vector3(0, -0.1, 0.9), Vector3(90, 0, 0)))


static func _shotgun(b: Node3D) -> void:
	var gun := Node3D.new()
	gun.rotation_degrees = Vector3(0, -25, -18)
	b.add_child(gun)
	for z in [-0.17, 0.17]:
		gun.add_child(_m(_cyl(0.16, 0.16, 2.2), STEEL, Vector3(0.3, 0.15, z), Vector3(0, 0, 90)))
	gun.add_child(_m(_box(0.5, 0.4, 0.55), DARK, Vector3(-0.75, 0.0, 0)))
	gun.add_child(_m(_box(1.0, 0.45, 0.32), ShotModels.BROWN, Vector3(-1.2, -0.15, 0), Vector3(0, 0, 14)))
	gun.add_child(_m(_cyl(0.0, 0.2, 0.5), ShotModels.RED, Vector3(1.35, 0.15, 0.0), Vector3(0, 0, -90)))


static func _gatling(b: Node3D) -> void:
	var gun := Node3D.new()
	gun.rotation_degrees = Vector3(0, -30, -10)
	b.add_child(gun)
	for i in 6:
		var a := i * TAU / 6.0
		gun.add_child(_m(_cyl(0.1, 0.1, 1.9), STEEL, Vector3(0.2, sin(a) * 0.38, cos(a) * 0.38), Vector3(0, 0, 90)))
	gun.add_child(_m(_cyl(0.55, 0.55, 0.5), DARK, Vector3(-0.8, 0, 0), Vector3(0, 0, 90)))
	gun.add_child(_m(_torus(0.42, 0.55), ShotModels.BRASS, Vector3(0.95, 0, 0), Vector3(0, 0, 90)))
	gun.add_child(_m(_box(0.3, 0.7, 0.3), ShotModels.RED, Vector3(-0.8, -0.65, 0)))
	for i in 3:
		gun.add_child(_m(_ball(0.13), ShotModels.GREEN, Vector3(1.4 + i * 0.4, 0.15 - i * 0.1, 0.1)))


static func _water_pistol(b: Node3D) -> void:
	var gun := Node3D.new()
	gun.rotation_degrees = Vector3(0, -28, 0)
	b.add_child(gun)
	gun.add_child(_m(_box(1.5, 0.5, 0.42), ShotModels.BLUE, Vector3(0.1, 0.4, 0)))
	gun.add_child(_m(_cyl(0.13, 0.17, 0.7), ShotModels.YELLOW, Vector3(1.05, 0.42, 0), Vector3(0, 0, 90)))
	gun.add_child(_m(_box(0.4, 0.9, 0.38), ShotModels.BLUE, Vector3(-0.35, -0.3, 0), Vector3(0, 0, 14)))
	gun.add_child(_m(_box(0.1, 0.35, 0.1), ShotModels.YELLOW, Vector3(0.12, -0.05, 0)))
	gun.add_child(_glass(_ball(0.45), Color(0.5, 0.8, 1.0, 0.6), Vector3(0.1, 0.9, 0)))
	gun.add_child(_m(_ball(0.1), ShotModels.WHITE, Vector3(1.5, 0.45, 0)))


static func _fist(b: Node3D) -> void:
	b.add_child(_m(_ball(0.62), TAN, Vector3(0, 0, 0), Vector3.ZERO, Vector3(1.15, 0.9, 1.0)))
	for i in 4:
		b.add_child(_m(_ball(0.27), TAN, Vector3(0.58, 0.42 - i * 0.28, 0.0)))
	b.add_child(_m(_ball(0.24), TAN, Vector3(0.1, 0.1, 0.62)))
	b.add_child(_m(_cyl(0.42, 0.5, 0.9), ShotModels.BROWN, Vector3(-0.85, -0.1, 0), Vector3(0, 0, 90)))
	b.add_child(_m(_cyl(0.46, 0.46, 0.14), ShotModels.GREEN, Vector3(-0.5, -0.1, 0), Vector3(0, 0, 90)))
	b.rotation_degrees = Vector3(0, -30, 12)


static func _spatula(b: Node3D) -> void:
	var tool := Node3D.new()
	tool.rotation_degrees = Vector3(0, -20, -35)
	b.add_child(tool)
	tool.add_child(_m(_cyl(0.1, 0.13, 1.5), ShotModels.RED, Vector3(0, -0.85, 0)))
	tool.add_child(_m(_cyl(0.09, 0.09, 0.5), STEEL, Vector3(0, 0.1, 0)))
	tool.add_child(_m(_box(1.1, 0.95, 0.07), STEEL, Vector3(0, 0.85, 0)))
	for x in [-0.33, 0.0, 0.33]:
		tool.add_child(_m(_box(0.1, 0.5, 0.09), DARK, Vector3(x, 0.9, 0)))


static func _pillow(b: Node3D) -> void:
	b.add_child(_m(_ball(1.0), CREAM, Vector3.ZERO, Vector3(0, 0, 0), Vector3(1.3, 0.62, 0.95)))
	b.add_child(_m(_ball(1.0), PINK, Vector3(0, 0.0, 0), Vector3(0, 0, 0), Vector3(0.35, 0.65, 0.97)))
	for p in [Vector3(-1.15, 0.0, 0.7), Vector3(1.15, 0.0, 0.7), Vector3(-1.15, 0.0, -0.7), Vector3(1.15, 0.0, -0.7)]:
		b.add_child(_m(_ball(0.15), ShotModels.YELLOW, p))
	b.rotation_degrees = Vector3(18, -25, 0)


static func _glue(b: Node3D) -> void:
	b.add_child(_m(_ball(1.0), Color("fff3b0"), Vector3(0, -0.55, 0), Vector3.ZERO, Vector3(1.5, 0.16, 1.2)))
	b.add_child(_m(_ball(0.18), Color("fff3b0"), Vector3(1.0, -0.4, 0.5), Vector3.ZERO, Vector3(1, 0.5, 1)))
	var bottle := Node3D.new()
	bottle.rotation_degrees = Vector3(0, 0, -20)
	bottle.position = Vector3(-0.2, 0.25, -0.1)
	b.add_child(bottle)
	bottle.add_child(_m(_cyl(0.45, 0.5, 1.1), ORANGE))
	bottle.add_child(_m(_cyl(0.0, 0.3, 0.55), ShotModels.WHITE, Vector3(0, 0.8, 0)))
	bottle.add_child(_m(_cyl(0.52, 0.52, 0.4), ShotModels.WHITE, Vector3(0, 0.0, 0)))


static func _claw(b: Node3D) -> void:
	b.add_child(_m(_ball(0.42), DARK, Vector3(0, 0.35, 0)))
	for i in 3:
		var arm := Node3D.new()
		arm.rotation_degrees.y = i * 120.0
		b.add_child(arm)
		arm.add_child(_m(_cyl(0.07, 0.11, 0.85), STEEL, Vector3(0.35, -0.1, 0), Vector3(0, 0, 28)))
		arm.add_child(_m(_cyl(0.0, 0.08, 0.4), STEEL, Vector3(0.12, -0.6, 0), Vector3(0, 0, -50)))
	b.add_child(_m(_cyl(0.05, 0.05, 1.1), ShotModels.BROWN, Vector3(0, 1.2, 0)))
	b.add_child(_m(_torus(0.28, 0.45), ShotModels.BROWN, Vector3(0.0, 1.95, 0), Vector3(90, 0, 0)))


static func _boot(b: Node3D) -> void:
	b.add_child(_m(_box(0.8, 1.1, 0.7), ShotModels.RED, Vector3(-0.2, 0.55, 0)))
	b.add_child(_m(_ball(0.45), ShotModels.RED, Vector3(0.55, 0.15, 0), Vector3.ZERO, Vector3(1.3, 0.8, 1.0)))
	b.add_child(_m(_cyl(0.46, 0.46, 0.2), ShotModels.WHITE, Vector3(-0.2, 1.1, 0)))
	b.add_child(_m(_box(1.3, 0.14, 0.78), ShotModels.WHITE, Vector3(0.1, -0.1, 0)))
	for i in 4:
		b.add_child(_m(_torus(0.2, 0.32), STEEL, Vector3(0.1, -0.38 - i * 0.18, 0), Vector3(90, 0, 0)))


static func _umbrella(b: Node3D) -> void:
	var dome := SphereMesh.new()
	dome.radius = 1.25
	dome.height = 1.25
	dome.is_hemisphere = true
	b.add_child(_m(dome, ShotModels.RED, Vector3(0, 0.2, 0)))
	var stripe := SphereMesh.new()
	stripe.radius = 1.27
	stripe.height = 1.27
	stripe.is_hemisphere = true
	b.add_child(_m(stripe, ShotModels.WHITE, Vector3(0, 0.2, 0), Vector3(0, 0, 0), Vector3(0.28, 1.0, 1.0)))
	b.add_child(_m(_cyl(0.05, 0.05, 1.7), ShotModels.BROWN, Vector3(0, -0.45, 0)))
	b.add_child(_m(_torus(0.1, 0.2), ShotModels.BROWN, Vector3(0.18, -1.3, 0), Vector3(0, 90, 0)))
	b.add_child(_m(_cyl(0.0, 0.08, 0.3), ShotModels.YELLOW, Vector3(0, 0.75, 0)))
	b.rotation_degrees = Vector3(10, 0, 12)


static func _jetpack(b: Node3D) -> void:
	for x in [-0.45, 0.45]:
		b.add_child(_m(_cyl(0.4, 0.4, 1.5), ShotModels.BLUE if x < 0 else ShotModels.RED, Vector3(x, 0.15, 0)))
		b.add_child(_m(_cyl(0.42, 0.42, 0.25), ShotModels.WHITE, Vector3(x, 0.2, 0)))
		b.add_child(_m(_cyl(0.3, 0.4, 0.2), STEEL, Vector3(x, 0.98, 0)))
		b.add_child(_m(_cyl(0.0, 0.3, 0.8), ORANGE, Vector3(x, -1.0, 0), Vector3(180, 0, 0)))
		b.add_child(_m(_cyl(0.0, 0.17, 0.5), ShotModels.YELLOW, Vector3(x, -0.85, 0), Vector3(180, 0, 0)))
	b.add_child(_m(_box(1.4, 0.2, 0.2), DARK, Vector3(0, 0.15, 0.4)))
	b.rotation_degrees = Vector3(0, -25, 0)


static func _burrow(b: Node3D) -> void:
	b.add_child(_m(_torus(0.55, 1.1), ShotModels.BROWN, Vector3(0, -0.1, 0)))
	b.add_child(_m(_cyl(0.7, 0.7, 0.1), Color("1d130c"), Vector3(0, -0.12, 0)))
	b.add_child(_m(_torus(0.3, 0.42), PURPLE, Vector3(0, 0.45, 0)))
	b.add_child(_m(_torus(0.18, 0.28), PINK, Vector3(0, 0.95, 0)))
	for p in [Vector3(-0.8, 0.7, 0.3), Vector3(0.7, 1.0, -0.2), Vector3(0.5, 0.3, 0.7), Vector3(-0.4, 1.2, -0.4)]:
		b.add_child(_m(_ball(0.1), ShotModels.YELLOW, p))
	b.rotation_degrees = Vector3(22, 0, 0)


static func _drill_hat(b: Node3D) -> void:
	var dome := SphereMesh.new()
	dome.radius = 0.9
	dome.height = 0.95
	dome.is_hemisphere = true
	b.add_child(_m(dome, ShotModels.YELLOW, Vector3(0, -0.5, 0)))
	b.add_child(_m(_cyl(1.05, 1.05, 0.15), ShotModels.YELLOW, Vector3(0, -0.55, 0)))
	b.add_child(_m(_cyl(0.0, 0.42, 1.5), STEEL, Vector3(0, 0.75, 0)))
	for i in 3:
		b.add_child(_m(_torus(0.3 - i * 0.07, 0.43 - i * 0.08), DARK, Vector3(0, 0.2 + i * 0.4, 0)))
	b.add_child(_m(_box(0.3, 0.12, 0.12), ShotModels.RED, Vector3(0, -0.2, 0.85)))


static func _blocks(b: Node3D) -> void:
	b.add_child(_m(_box(1.3, 1.0, 1.3), ShotModels.BLUE, Vector3(-0.2, -0.4, 0)))
	for p in [Vector3(-0.5, 0.2, -0.3), Vector3(0.1, 0.2, -0.3), Vector3(-0.5, 0.2, 0.3), Vector3(0.1, 0.2, 0.3)]:
		b.add_child(_m(_cyl(0.18, 0.18, 0.22), ShotModels.BLUE, p + Vector3(0, 0.0, 0)))
	var top := _m(_box(0.9, 0.7, 0.9), ShotModels.YELLOW, Vector3(0.45, 0.5, 0.1), Vector3(0, 28, 0))
	b.add_child(top)
	b.add_child(_m(_cyl(0.16, 0.16, 0.2), ShotModels.YELLOW, Vector3(0.45, 0.95, 0.1)))
	b.rotation_degrees = Vector3(0, -15, 0)


static func _feather(b: Node3D) -> void:
	var f := Node3D.new()
	f.rotation_degrees = Vector3(0, -20, -30)
	b.add_child(f)
	f.add_child(_m(_ball(1.0), Color("5fd0c8"), Vector3(0, 0.25, 0), Vector3.ZERO, Vector3(0.38, 1.5, 0.07)))
	f.add_child(_m(_ball(1.0), PINK, Vector3(0.12, 0.1, 0.02), Vector3.ZERO, Vector3(0.22, 1.1, 0.08)))
	f.add_child(_m(_cyl(0.035, 0.035, 2.5), ShotModels.WHITE, Vector3(0, 0.0, 0.0)))
	b.add_child(_m(_torus(0.16, 0.3), ShotModels.BRASS, Vector3(0.3, -1.3, 0.05), Vector3(90, 0, 20)))


static func _bubble(b: Node3D) -> void:
	b.add_child(_m(_ball(0.42), ShotModels.WHITE, Vector3(0, -0.3, 0), Vector3.ZERO, Vector3(1, 0.7, 1)))
	b.add_child(_m(_ball(0.32), PINK, Vector3(0, 0.0, 0)))
	b.add_child(_glass(_ball(1.15), Color(0.65, 0.88, 1.0, 0.34)))
	b.add_child(_m(_ball(0.16), Color.WHITE, Vector3(-0.55, 0.6, 0.55), Vector3.ZERO, Vector3(1.0, 1.5, 0.5)))
	b.add_child(_m(_ball(0.07), Color.WHITE, Vector3(-0.3, 0.85, 0.5)))


static func _cookie(b: Node3D) -> void:
	b.add_child(_m(_cyl(1.0, 1.0, 0.32), Color("d99a4e"), Vector3.ZERO, Vector3(70, 0, 0)))
	b.add_child(_m(_cyl(0.78, 0.78, 0.36), Color("e8b36a"), Vector3(0, 0.0, 0.0), Vector3(70, 0, 0)))
	for p in [Vector3(-0.35, 0.3, 0.2), Vector3(0.3, 0.45, 0.25), Vector3(0.0, -0.1, 0.4), Vector3(-0.5, -0.3, 0.1), Vector3(0.45, -0.25, 0.3)]:
		b.add_child(_m(_ball(0.16), Color("4a2a18"), p, Vector3.ZERO, Vector3(1, 1, 0.7)))
	b.rotation_degrees = Vector3(0, -15, 10)


static func _hanky(b: Node3D) -> void:
	b.add_child(_m(_cyl(0.07, 0.09, 2.4), ShotModels.BROWN, Vector3(-0.8, -0.2, 0)))
	b.add_child(_m(_ball(0.13), ShotModels.BRASS, Vector3(-0.8, 1.05, 0)))
	var cloth := _box(1.6, 1.1, 0.06)
	b.add_child(_m(cloth, ShotModels.WHITE, Vector3(0.05, 0.55, 0), Vector3(0, 8, 0)))
	b.add_child(_m(_box(0.7, 0.9, 0.06), Color("e9eef5"), Vector3(1.05, 0.5, 0.12), Vector3(0, 30, 6)))
	b.add_child(_m(_box(1.6, 0.1, 0.08), Color("c9d6e8"), Vector3(0.05, 0.05, 0.02), Vector3(0, 8, 0)))
	b.rotation_degrees = Vector3(0, -20, 0)


static func _table(b: Node3D) -> void:
	var table := Node3D.new()
	table.rotation_degrees = Vector3(0, -25, 14)
	b.add_child(table)
	table.add_child(_m(_box(2.0, 0.22, 1.4), ShotModels.BROWN, Vector3(0, 0.1, 0)))
	for x in [-0.8, 0.8]:
		for z in [-0.5, 0.5]:
			table.add_child(_m(_cyl(0.1, 0.12, 0.9), ShotModels.DARK_BROWN, Vector3(x, -0.45, z)))
	for p in [Vector3(-0.5, 0.45, 0.2), Vector3(0.4, 0.7, -0.2), Vector3(0.7, 0.4, 0.3)]:
		table.add_child(_m(_ball(0.16), ShotModels.GREEN if p.x < 0 else ShotModels.YELLOW, p))
	var crack := _m(_box(1.4, 0.05, 0.08), ShotModels.RED, Vector3(0.0, 0.23, 0.0), Vector3(0, 20, 0))
	table.add_child(crack)
