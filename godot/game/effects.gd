class_name MatchEffects
extends Node3D
## Explosion flash and debris, screen shake and floating damage numbers at 3D positions
## (port of client/src/game3d/effects3d.ts). Effects clean themselves up with tweens.

## Colour of the chunks an explosion throws; the match scene sets it from the map theme.
var debris_color := Color("8b5a2b")
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
	chunk_mat.albedo_color = debris_color
	debris.material_override = chunk_mat
	add_child(debris)
	debris.emitting = true
	get_tree().create_timer(2.5).timeout.connect(debris.queue_free)

	_smoke(at, radius)
	_shake = minf(1.0, _shake + radius / 14.0)


## A lingering cartoon smoke cloud: soft grey balls that rise, swell and fade.
func _smoke(at: Vector3, radius: float) -> void:
	var smoke := CPUParticles3D.new()
	smoke.position = at
	smoke.amount = 18
	smoke.lifetime = 2.2
	smoke.one_shot = true
	smoke.explosiveness = 0.85
	smoke.direction = Vector3.UP
	smoke.spread = 55.0
	smoke.initial_velocity_min = radius * 0.4
	smoke.initial_velocity_max = radius * 1.1
	smoke.gravity = Vector3(0, 3.0, 0)
	smoke.damping_min = 1.5
	smoke.damping_max = 3.0
	smoke.scale_amount_min = 0.7
	smoke.scale_amount_max = 1.3
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.4))
	curve.add_point(Vector2(0.5, 1.0))
	curve.add_point(Vector2(1.0, 1.5))
	smoke.scale_amount_curve = curve
	var fade := Gradient.new()
	fade.set_color(0, Color(0.92, 0.9, 0.88, 0.85))
	fade.set_color(1, Color(0.6, 0.58, 0.58, 0.0))
	smoke.color_ramp = fade
	var ball := SphereMesh.new()
	ball.radius = maxf(0.8, radius * 0.35)
	ball.height = ball.radius * 2.0
	ball.radial_segments = 10
	ball.rings = 6
	smoke.mesh = ball
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smoke.material_override = m
	add_child(smoke)
	smoke.emitting = true
	get_tree().create_timer(3.2).timeout.connect(smoke.queue_free)


## The streak of an instant shot: a bright thin bar from the muzzle to where it stopped, gone in a
## blink, with a puff at the muzzle.
func tracer(from: Vector3, to: Vector3) -> void:
	var span := to - from
	var length := span.length()
	if length < 0.01:
		return
	var bar := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.22, 0.22, 1.0)
	bar.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1.0, 0.95, 0.7, 0.95)
	mat.emission_enabled = true
	mat.emission = Color("ffd24a")
	mat.emission_energy_multiplier = 4.0
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bar.material_override = mat
	bar.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(bar)
	# The bar's own z axis runs along the shot.
	var dir := span / length
	var up := Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT
	bar.global_transform = Transform3D(Basis.looking_at(dir, up), from + span * 0.5)
	bar.scale = Vector3(1.0, 1.0, length)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(bar, "scale", Vector3(0.1, 0.1, length), 0.28)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.28)
	tw.chain().tween_callback(bar.queue_free)
	puff(from, 1.6)
	_shake = minf(1.0, _shake + 0.12)


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


## Floating "-23" above a point. Bigger hits are bigger and redder, and every number pops in.
func damage(at: Vector3, amount: int) -> void:
	var heavy := clampf(float(amount) / 60.0, 0.0, 1.0)
	var label := Label3D.new()
	label.text = "-%d" % amount
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.pixel_size = 0.05
	label.font_size = int(lerpf(56.0, 104.0, heavy))
	label.outline_size = 22
	label.modulate = Color("ffb52e").lerp(Color("e8392b"), heavy)
	label.outline_modulate = Color("fff8ea")
	label.position = at
	label.scale = Vector3.ONE * 0.2
	add_child(label)
	var tw := create_tween()
	tw.tween_property(label, "scale", Vector3.ONE * 1.25, 0.12)
	tw.tween_property(label, "scale", Vector3.ONE, 0.1)
	var rise := create_tween()
	rise.set_parallel(true)
	rise.tween_property(label, "position:y", at.y + 8.0, 1.4)
	rise.tween_property(label, "modulate:a", 0.0, 0.9).set_delay(0.6)
	rise.chain().tween_callback(label.queue_free)


## Decay the shake and pick this frame's camera offset. Add `shake_offset` to the camera, then remove it.
func update(dt: float) -> void:
	_shake = maxf(0.0, _shake - dt * 1.8)
	var s := _shake * _shake * 1.6
	shake_offset = Vector3(
		_rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s
	)
