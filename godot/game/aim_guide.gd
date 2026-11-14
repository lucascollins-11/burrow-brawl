class_name AimGuide
extends Node3D
## A short dotted launch guide for charged throws: the first stretch of the arc the shot will fly,
## drawn from the head along the aim at the power you have charged so far. It ignores the wind and
## stops where the ground is, so it only tells you where the shot starts, not where it lands. With no
## charge there is nothing to draw: seen from the head, a straight sight line is just the crosshair.

## Max launch speed (sim units per second) of every weapon with an aim-angle-power arc, from
## shared/weapons/*.json. All of them fall at GRAVITY; a rocket flies flat and a roller is not an arc,
## so those are left out.
const SPEEDS := {
	"acorn-mortar": 900.0, "fizz-grenade": 700.0, "glue-puddle": 800.0, "gumball-cluster": 700.0,
	"hopper-ball": 700.0, "hot-sauce-flask": 800.0, "pinecone-popper": 800.0, "slingshot": 1100.0,
	"snow-globe": 700.0,
}
const GRAVITY := 600.0
## Sim units are 3/10 of a voxel (shared/src/sim3d/constants.ts: LENGTH_NUM / LENGTH_DEN).
const UNIT := 0.3
const DOTS := 12
const SPACING_S := 0.07

var _dots: Array[MeshInstance3D] = []


func _ready() -> void:
	name = "AimGuide"
	var mesh := SphereMesh.new()
	mesh.radius = 0.32
	mesh.height = 0.64
	mesh.radial_segments = 8
	mesh.rings = 4
	for i in DOTS:
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = Color("fff3c4")
		mat.no_depth_test = true
		mat.render_priority = 8
		var d := MeshInstance3D.new()
		d.mesh = mesh
		d.material_override = mat
		d.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		d.visible = false
		add_child(d)
		_dots.append(d)


## Whether a weapon throws in an arc this guide can draw.
static func has_arc(weapon_id: String) -> bool:
	return SPEEDS.has(weapon_id)


## Dot positions for a throw from `origin` along unit direction `dir` with `power` 0..100. The
## arc stops (and the last point is kept) when `ground` (a Callable x, z -> height) rises above it.
static func arc_points(origin: Vector3, dir: Vector3, weapon_id: String, power: float, ground: Callable) -> Array[Vector3]:
	var out: Array[Vector3] = []
	var speed: float = float(SPEEDS.get(weapon_id, 0.0)) * power / 100.0 * UNIT
	if speed <= 0.0:
		return out
	var g := GRAVITY * UNIT
	for i in range(1, DOTS + 1):
		var t := SPACING_S * float(i)
		var p := origin + dir * speed * t + Vector3(0, -0.5 * g * t * t, 0)
		if ground.is_valid() and p.y < float(ground.call(p.x, p.z)):
			break
		out.append(p)
	return out


## Show the guide for the active critter while a charge builds, or hide it. `aim` may be null.
func update_guide(aim: CameraMath.AimState, active: Dictionary, weapon_id: String, ground: Callable) -> void:
	var pts: Array[Vector3] = []
	if aim != null and not active.is_empty() and has_arc(weapon_id):
		var origin: Vector3 = (active["pos"] as Vector3) + Vector3(0, Squirmling.HEIGHT * 0.86, 0)
		var dir := CameraMath.aim_direction(aim)
		if aim.power > 0.0:
			pts = arc_points(origin + dir * 1.5, dir, weapon_id, aim.power, ground)
	for i in _dots.size():
		var d := _dots[i]
		d.visible = i < pts.size()
		if d.visible:
			d.position = pts[i]
			var s := 1.0 - 0.45 * float(i) / float(DOTS)
			d.scale = Vector3.ONE * s
