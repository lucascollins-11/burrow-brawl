class_name MatchEffects
extends Node3D
## Explosion flash and debris, screen shake and floating damage numbers at 3D positions
## (port of client/src/game3d/effects3d.ts). Effects clean themselves up with tweens.

var shake_offset: Vector3 = Vector3.ZERO
var _shake: float = 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()  # looks only; effects never touch the simulation


func explode(at: Vector3, radius: float) -> void:
	var flash := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 1.0
	s.height = 2.0
	flash.mesh = s
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1.0, 0.92, 0.6, 0.9)
	mat.emission_enabled = true
	mat.emission = Color("ffcf6a")
	mat.emission_energy_multiplier = 3.0
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flash.material_override = mat
	flash.position = at
	flash.scale = Vector3.ONE * maxf(0.1, radius * 0.4)
	add_child(flash)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(flash, "scale", Vector3.ONE * radius * 1.3, 0.45)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.45)
	tw.chain().tween_callback(flash.queue_free)

	var debris := CPUParticles3D.new()
	debris.position = at
	debris.amount = 70
	debris.lifetime = 1.4
	debris.one_shot = true
	debris.explosiveness = 1.0
	debris.direction = Vector3.UP
	debris.spread = 80.0
	debris.initial_velocity_min = radius * 1.5
	debris.initial_velocity_max = radius * 4.0
	debris.gravity = Vector3(0, -60, 0)
	var chunk := BoxMesh.new()
	chunk.size = Vector3(0.7, 0.7, 0.7)
	debris.mesh = chunk
	var chunk_mat := StandardMaterial3D.new()
	chunk_mat.albedo_color = Color("8b5a2b")
	debris.material_override = chunk_mat
	add_child(debris)
	debris.emitting = true
	get_tree().create_timer(2.5).timeout.connect(debris.queue_free)

	_shake = minf(1.0, _shake + radius / 14.0)


## Small puff for shots that do not explode (muzzle, impacts).
func puff(at: Vector3, radius := 2.0) -> void:
	var p := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 1.0
	s.height = 2.0
	p.mesh = s
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1, 1, 1, 0.7)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	p.material_override = mat
	p.position = at
	p.scale = Vector3.ONE * 0.3
	add_child(p)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(p, "scale", Vector3.ONE * radius, 0.3)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.3)
	tw.chain().tween_callback(p.queue_free)


## Floating "-23" above a point.
func damage(at: Vector3, amount: int) -> void:
	var label := Label3D.new()
	label.text = "-%d" % amount
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.pixel_size = 0.05
	label.font_size = 64
	label.outline_size = 18
	label.modulate = Color("e85d4a")
	label.outline_modulate = Color("fff8ea")
	label.position = at
	add_child(label)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(label, "position:y", at.y + 8.0, 1.4)
	tw.tween_property(label, "modulate:a", 0.0, 1.4).set_delay(0.5)
	tw.chain().tween_callback(label.queue_free)


## Decay the shake and pick this frame's camera offset. Add `shake_offset` to the camera, then remove it.
func update(dt: float) -> void:
	_shake = maxf(0.0, _shake - dt * 1.8)
	var s := _shake * _shake * 1.6
	shake_offset = Vector3(
		_rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s
	)
