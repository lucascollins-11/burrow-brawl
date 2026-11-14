class_name MatchEffects
extends Node3D
## Explosion flash and debris, screen shake and floating damage numbers at 3D positions
## (port of client/src/game3d/effects3d.ts). Effects clean themselves up with tweens.

## Colour of the chunks an explosion throws; the match scene sets it from the map theme.
const Toon := preload("res://game/toon.gd")

var debris_color := Color("8b5a2b")
var shake_offset: Vector3 = Vector3.ZERO
var _shake: float = 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()  # looks only; effects never touch the simulation


## Where the listener (camera) is, so far-away blasts shake the screen less. Set each frame.
var listener := Vector3.INF


## A big cartoon blast sized by `radius` (voxels): white-hot core, a swelling fireball, a shock ring
## on the ground, sparks, tumbling chunks of ground, a smoke cloud, a flash of light and a screen kick.
func explode(at: Vector3, radius: float) -> void:
	var r := maxf(1.0, radius)
	_core_flash(at, r)
	_fireball(at, r)
	_ring(at, r * 2.4, 0.42, Color(1.0, 0.95, 0.8, 0.85))
	_sparks(at, r)
	_chunks(at, r)
	_smoke(at, r)
	_light_flash(at, r)
	_kick(at, clampf(r / 9.0, 0.18, 1.0))


func _unshaded(color: Color, emit := 0.0) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
	mat.albedo_color = color
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if emit > 0.0:
		mat.emission_enabled = true
		mat.emission = Color(color.r, color.g, color.b)
		mat.emission_energy_multiplier = emit
	return mat


func _ball(at: Vector3, mat: Material, start: float) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 1.0
	s.height = 2.0
	s.radial_segments = 16
	s.rings = 8
	m.mesh = s
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	m.position = at
	m.scale = Vector3.ONE * start
	add_child(m)
	return m


## The blinding white centre: pops big and is gone in a blink.
func _core_flash(at: Vector3, r: float) -> void:
	var mat := _unshaded(Color(1.0, 1.0, 0.9, 1.0), 4.0)
	var flash := _ball(at + Vector3(0, r * 0.3, 0), mat, r * 0.3)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(flash, "scale", Vector3.ONE * r * 1.0, 0.12)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.16)
	tw.chain().tween_callback(flash.queue_free)


## The fireball: yellow to orange to dark red while it swells and thins out.
func _fireball(at: Vector3, r: float) -> void:
	var mat := _unshaded(Color(1.0, 0.85, 0.3, 0.95), 2.2)
	# Lifted a little so a blast at the bottom of its own crater is not swallowed by the ground.
	var ball := _ball(at + Vector3(0, r * 0.35, 0), mat, r * 0.4)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(ball, "scale", Vector3.ONE * r * 1.35, 0.5).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
	tw.tween_property(mat, "albedo_color", Color(0.85, 0.22, 0.08, 0.0), 0.55)
	tw.tween_property(mat, "emission_energy_multiplier", 0.2, 0.55)
	tw.chain().tween_callback(ball.queue_free)


## A flat ring that races outwards (shock wave on the ground, splash ripple).
func _ring(at: Vector3, final_radius: float, seconds: float, color: Color) -> void:
	var m := MeshInstance3D.new()
	var t := TorusMesh.new()
	t.inner_radius = 0.82
	t.outer_radius = 1.0
	t.rings = 24
	t.ring_segments = 6
	m.mesh = t
	var mat := _unshaded(color)
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	m.position = at
	m.scale = Vector3(0.3, 0.3, 0.3)
	add_child(m)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(m, "scale", Vector3(final_radius, final_radius * 0.35, final_radius), seconds).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(mat, "albedo_color:a", 0.0, seconds)
	tw.chain().tween_callback(m.queue_free)


## Hot sparks: small bright chunks that fly fast and fall.
func _sparks(at: Vector3, r: float) -> void:
	var sparks := CPUParticles3D.new()
	sparks.position = at
	sparks.amount = int(clampf(16.0 + r * 4.0, 16.0, 80.0))
	sparks.lifetime = 0.8
	sparks.one_shot = true
	sparks.explosiveness = 1.0
	sparks.direction = Vector3.UP
	sparks.spread = 100.0
	sparks.initial_velocity_min = r * 3.0
	sparks.initial_velocity_max = r * 8.0
	sparks.gravity = Vector3(0, -50, 0)
	var bit := BoxMesh.new()
	bit.size = Vector3(0.28, 0.28, 0.28)
	sparks.mesh = bit
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
	mat.albedo_color = Color("ffd24a")
	mat.emission_enabled = true
	mat.emission = Color("ffb52e")
	mat.emission_energy_multiplier = 3.0
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sparks.material_override = mat
	sparks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sparks)
	sparks.emitting = true
	get_tree().create_timer(1.6).timeout.connect(sparks.queue_free)


## Chunks of ground: a few big tumbling lumps and many small crumbs, two shades of the map's soil.
func _chunks(at: Vector3, r: float) -> void:
	var shades := [debris_color, debris_color.darkened(0.35)]
	for i in range(2):
		var big := i == 0
		var chunks := CPUParticles3D.new()
		chunks.position = at
		chunks.amount = int(clampf((6.0 + r * 1.2) if big else (24.0 + r * 5.0), 6.0, 90.0))
		chunks.lifetime = 1.7 if big else 1.3
		chunks.one_shot = true
		chunks.explosiveness = 1.0
		chunks.randomness = 0.6
		chunks.direction = Vector3.UP
		chunks.spread = 70.0 if big else 90.0
		chunks.initial_velocity_min = r * (1.6 if big else 1.2)
		chunks.initial_velocity_max = r * (3.6 if big else 5.0)
		chunks.gravity = Vector3(0, -62, 0)
		chunks.angular_velocity_min = -300.0
		chunks.angular_velocity_max = 300.0
		chunks.particle_flag_rotate_y = true
		var box := BoxMesh.new()
		box.size = Vector3.ONE * (1.1 if big else 0.5)
		chunks.mesh = box
		var mat := StandardMaterial3D.new()
		Toon.shade(mat)
		mat.albedo_color = shades[i]
		mat.roughness = 1.0
		chunks.material_override = mat
		add_child(chunks)
		chunks.emitting = true
		get_tree().create_timer(2.6).timeout.connect(chunks.queue_free)


## A short orange flash of light over the ground around the blast.
func _light_flash(at: Vector3, r: float) -> void:
	var light := OmniLight3D.new()
	light.position = at + Vector3(0, r * 0.5, 0)
	light.light_color = Color("ffb04a")
	light.light_energy = 6.0
	light.omni_range = r * 6.0 + 10.0
	light.shadow_enabled = false
	add_child(light)
	var tw := create_tween()
	tw.tween_property(light, "light_energy", 0.0, 0.4)
	tw.tween_callback(light.queue_free)


## Add screen shake for something at `at`: full strength nearby, weaker far from the camera.
func _kick(at: Vector3, amount: float) -> void:
	var falloff := 1.0
	if listener != Vector3.INF:
		falloff = clampf(1.0 - (listener.distance_to(at) - 40.0) / 220.0, 0.25, 1.0)
	_shake = minf(1.0, _shake + amount * falloff)


## Something hit the soda: a ripple, a column of drops, a foam puff. `at` is on the sea surface.
func splash(at: Vector3, size := 3.0) -> void:
	var s := maxf(1.0, size)
	_ring(at + Vector3(0, 0.15, 0), s * 2.6, 0.7, Color(0.85, 0.97, 1.0, 0.8))
	_ring(at + Vector3(0, 0.1, 0), s * 1.6, 0.5, Color(1, 1, 1, 0.7))
	var drops := CPUParticles3D.new()
	drops.position = at
	drops.amount = int(clampf(14.0 + s * 4.0, 14.0, 50.0))
	drops.lifetime = 1.1
	drops.one_shot = true
	drops.explosiveness = 1.0
	drops.randomness = 0.5
	drops.direction = Vector3.UP
	drops.spread = 30.0
	drops.initial_velocity_min = s * 3.0
	drops.initial_velocity_max = s * 6.5
	drops.gravity = Vector3(0, -48, 0)
	var drop := SphereMesh.new()
	drop.radius = 0.35
	drop.height = 0.7
	drop.radial_segments = 8
	drop.rings = 4
	drops.mesh = drop
	drops.material_override = _unshaded(Color(0.8, 0.95, 1.0, 0.9))
	drops.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(drops)
	drops.emitting = true
	get_tree().create_timer(2.0).timeout.connect(drops.queue_free)
	puff(at + Vector3(0, 0.8, 0), s * 1.2)
	_kick(at, clampf(s / 14.0, 0.04, 0.3))


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
	Toon.shade(m)
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smoke.material_override = m
	add_child(smoke)
	smoke.emitting = true
	get_tree().create_timer(3.2).timeout.connect(smoke.queue_free)


## The streak of an instant shot: a bright thin bar from the muzzle to where it stopped, gone in a
## blink, with a puff at the muzzle.
func tracer(from: Vector3, to: Vector3, hit := false, weapon := "") -> void:
	var span := to - from
	var length := span.length()
	if length < 0.01:
		return
	var bar := MeshInstance3D.new()
	var box := BoxMesh.new()
	# Pellets are yellow sparks, peas green and thin, water a fat blue squirt.
	var glow := Color("ffd24a")
	var thick := 0.22
	if weapon == "water-pistol":
		glow = Color("62b8ff")
		thick = 0.45
	elif weapon == "pea-gatling":
		glow = Color("7ee06a")
		thick = 0.16
	box.size = Vector3(thick, thick, 1.0)
	bar.mesh = box
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
	mat.albedo_color = Color(glow.r, glow.g, glow.b, 0.95).lerp(Color(1, 1, 1, 0.95), 0.55)
	mat.emission_enabled = true
	mat.emission = glow
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
	if hit and weapon == "water-pistol":
		splash(to, 1.6)
	elif hit:
		_sparks(to, 1.4)
		puff(to, 1.8)
	_kick(from, 0.12 if weapon != "pea-gatling" else 0.04)


## The Root Punch: a hard shock ring, sparks and a comic "POW!" when it connects.
func punch(at: Vector3, hits: int) -> void:
	_ring(at, 6.0, 0.3, Color(1.0, 0.95, 0.7, 0.9))
	puff(at, 3.5)
	if hits > 0:
		_sparks(at, 2.2)
		_word(at + Vector3(0, 3.0, 0), "POW!", Color("ffd23f"))
		_kick(at, 0.3)
	else:
		_kick(at, 0.08)


## A swing of the Spatula Swat (a wide silver arc and "WHAP!") or the Pillow Bash (a soft white
## burst of feathers and "FWUMP!"); anything else is the Root Punch. `at` is where it landed.
func melee(at: Vector3, hits: int, weapon: String) -> void:
	if weapon == "spatula-swat":
		_ring(at, 9.0, 0.35, Color(0.85, 0.88, 0.95, 0.9))
		_ring(at + Vector3(0, 0.6, 0), 6.0, 0.25, Color(1.0, 1.0, 1.0, 0.8))
		if hits > 0:
			_sparks(at, 2.4)
			_word(at + Vector3(0, 3.0, 0), "WHAP!", Color("d9dee4"))
			_kick(at, 0.35)
		else:
			_kick(at, 0.1)
	elif weapon == "pillow-bash":
		burst(at + Vector3(0, 1.5, 0), Color("fff6e8"))
		_ring(at, 8.0, 0.4, Color(1.0, 0.95, 0.9, 0.7))
		if hits > 0:
			_word(at + Vector3(0, 3.0, 0), "FWUMP!", Color("fff6e8"))
			_kick(at, 0.3)
	else:
		punch(at, hits)


## A comic word that pops in over a point and floats away.
func _word(at: Vector3, text: String, color: Color) -> void:
	var label := Label3D.new()
	label.text = text
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.pixel_size = 0.06
	label.font_size = 96
	label.outline_size = 26
	label.modulate = color
	label.outline_modulate = Color("3b2a1a")
	label.position = at
	label.scale = Vector3.ONE * 0.2
	label.rotation_degrees.z = _rng.randf_range(-12.0, 12.0)
	add_child(label)
	var tw := create_tween()
	tw.tween_property(label, "scale", Vector3.ONE * 1.3, 0.1)
	tw.tween_property(label, "scale", Vector3.ONE, 0.08)
	var rise := create_tween()
	rise.set_parallel(true)
	rise.tween_property(label, "position:y", at.y + 5.0, 0.9)
	rise.tween_property(label, "modulate:a", 0.0, 0.5).set_delay(0.4)
	rise.chain().tween_callback(label.queue_free)


## Teleport Burrow: sparkles sucked into a column where the critter vanished, and a burst of them
## where it pops out. Both points are at the critter's middle.
func teleport(from: Vector3, to: Vector3) -> void:
	_swirl(from, true)
	_swirl(to, false)
	_column(from, Color(0.7, 0.55, 1.0, 0.6))
	_column(to, Color(0.55, 0.95, 1.0, 0.6))
	puff(from, 4.0)
	puff(to, 4.0)


func _swirl(at: Vector3, inward: bool) -> void:
	var p := CPUParticles3D.new()
	p.position = at
	p.amount = 40
	p.lifetime = 0.8
	p.one_shot = true
	p.explosiveness = 0.9
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE_SURFACE
	p.emission_sphere_radius = 4.0 if inward else 0.5
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = 0.0 if inward else 6.0
	p.initial_velocity_max = 1.0 if inward else 12.0
	p.gravity = Vector3.ZERO
	p.radial_accel_min = -14.0 if inward else 0.0
	p.radial_accel_max = -9.0 if inward else 0.0
	p.damping_min = 0.0 if inward else 6.0
	p.damping_max = 0.0 if inward else 9.0
	var bit := SphereMesh.new()
	bit.radius = 0.28
	bit.height = 0.56
	bit.radial_segments = 6
	bit.rings = 3
	p.mesh = bit
	var fade := Gradient.new()
	fade.set_color(0, Color(0.85, 0.7, 1.0, 1.0) if inward else Color(0.7, 1.0, 1.0, 1.0))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	p.color_ramp = fade
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.emission_enabled = true
	m.emission = Color(0.8, 0.8, 1.0)
	m.emission_energy_multiplier = 2.0
	p.material_override = m
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	p.emitting = true
	get_tree().create_timer(1.6).timeout.connect(p.queue_free)


## A tall soft light column that thins out.
func _column(at: Vector3, color: Color) -> void:
	var m := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 1.4
	c.bottom_radius = 1.4
	c.height = 14.0
	c.radial_segments = 14
	m.mesh = c
	var mat := _unshaded(color, 1.5)
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	m.position = at + Vector3(0, 5.0, 0)
	add_child(m)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(m, "scale", Vector3(0.1, 1.2, 0.1), 0.6)
	tw.tween_property(mat, "albedo_color:a", 0.0, 0.6)
	tw.chain().tween_callback(m.queue_free)


## A cluster shot popping in the air: a puff and a spray of little seeds.
func burst(at: Vector3, color: Color) -> void:
	puff(at, 3.5)
	_ring(at, 4.5, 0.3, Color(1, 1, 1, 0.6))
	var p := CPUParticles3D.new()
	p.position = at
	p.amount = 18
	p.lifetime = 0.5
	p.one_shot = true
	p.explosiveness = 1.0
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = 6.0
	p.initial_velocity_max = 13.0
	p.gravity = Vector3(0, -20, 0)
	var bit := SphereMesh.new()
	bit.radius = 0.3
	bit.height = 0.6
	bit.radial_segments = 6
	bit.rings = 3
	p.mesh = bit
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
	mat.albedo_color = color
	p.material_override = mat
	add_child(p)
	p.emitting = true
	get_tree().create_timer(1.2).timeout.connect(p.queue_free)
	_kick(at, 0.1)


## A crate thumping down: a flat dust ring and a few crumbs.
func dust(at: Vector3, size := 2.0) -> void:
	_ring(at + Vector3(0, 0.2, 0), size * 2.2, 0.5, Color(0.85, 0.75, 0.6, 0.6))
	puff(at + Vector3(0, 0.8, 0), size)
	_kick(at, 0.08)


## Tabletop Quake: the whole table thumps. A hard camera shake, three ground rings that roll out
## from the thumper and a heap of dust.
func quake(at: Vector3) -> void:
	_kick(at, 1.0)
	for i in 3:
		var tw := create_tween()
		tw.tween_interval(0.12 * float(i))
		tw.tween_callback(func() -> void: _ring(at + Vector3(0, 0.2, 0), 18.0 + 14.0 * float(i), 0.9, Color(0.85, 0.72, 0.55, 0.7)))
	puff(at + Vector3(0, 0.8, 0), 4.0)
	puff(at + Vector3(3, 0.8, 2), 3.0)
	puff(at + Vector3(-3, 0.8, -2), 3.0)


## Small puff for shots that do not explode (muzzle, impacts).
func puff(at: Vector3, radius := 2.0) -> void:
	var p := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 1.0
	s.height = 2.0
	p.mesh = s
	var mat := StandardMaterial3D.new()
	Toon.shade(mat)
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


## Floating green "+25" or "+1 Fizz Grenade" above whoever took a crate, with a pale puff.
func pickup(at: Vector3, text: String) -> void:
	var label := Label3D.new()
	label.text = text
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.pixel_size = 0.05
	label.font_size = 64
	label.outline_size = 20
	label.modulate = Color("5cc49b")
	label.outline_modulate = Color("fff8ea")
	label.position = at
	label.scale = Vector3.ONE * 0.2
	add_child(label)
	var tw := create_tween()
	tw.tween_property(label, "scale", Vector3.ONE * 1.2, 0.12)
	tw.tween_property(label, "scale", Vector3.ONE, 0.1)
	var rise := create_tween()
	rise.set_parallel(true)
	rise.tween_property(label, "position:y", at.y + 9.0, 1.8)
	rise.tween_property(label, "modulate:a", 0.0, 1.0).set_delay(0.8)
	rise.chain().tween_callback(label.queue_free)
	puff(at, 3.0)


## A snack's heal: a green "+12" rising from the critter and a soft ring round its middle.
func heal(at: Vector3, amount: int) -> void:
	pickup(at, "+%d" % amount)
	_ring(at - Vector3(0, 3.0, 0), 5.0, 0.6, Color(0.36, 0.77, 0.6, 0.6))


## Decay the shake and pick this frame's camera offset. Add `shake_offset` to the camera, then remove it.
func update(dt: float) -> void:
	_shake = maxf(0.0, _shake - dt * 1.8)
	var s := _shake * _shake * 1.6
	shake_offset = Vector3(
		_rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s, _rng.randf_range(-0.5, 0.5) * s
	)
