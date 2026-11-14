class_name GearFx
extends Node3D
## What a Squirmling is wearing or doing, drawn next to the critter: a jetpack with a fizz plume,
## an open umbrella, spring boots, drill dust, the Rope Claw's rope and the Bubble Shield.
## Fed the critter list of a ViewModel snapshot every frame; nothing here reads the network.
## All parts are built from primitives and particles, like the rest of the match visuals.

const Toon := preload("res://game/toon.gd")
const SODA := Color("e8503c")
const FIZZ := Color(0.8, 0.95, 1.0, 0.8)
const DUST := Color(0.62, 0.5, 0.36, 0.7)

## critter id -> {root: Node3D, act: String, shield: Node3D or null, rope: Node3D or null}
var _gear: Dictionary = {}
var _t := 0.0


func sync(critters: Array, dt: float) -> void:
	_t += dt
	var seen := {}
	for c: Dictionary in critters:
		var id := int(c["id"])
		var act := str(c.get("act", "")) if bool(c.get("alive", true)) else ""
		var shield := bool(c.get("shield", false)) and bool(c.get("alive", true))
		var frozen := bool(c.get("frozen", false)) and bool(c.get("alive", true))
		var feather := bool(c.get("feather", false)) and bool(c.get("alive", true))
		if act == "" and not shield and not frozen and not feather:
			_drop(id)
			continue
		seen[id] = true
		var g: Dictionary = _gear.get(id, {})
		if g.is_empty():
			var root := Node3D.new()
			root.name = "Gear%d" % id
			add_child(root)
			g = {"root": root, "act": "", "shield": null, "rope": null, "ice": null, "glow": null}
			_gear[id] = g
		var root: Node3D = g["root"]
		root.position = c["pos"]
		root.rotation.y = deg_to_rad(float(c.get("heading_deg", 0.0)))
		if g["act"] != act:
			var old := root.get_node_or_null("Act")
			if old != null:
				root.remove_child(old)
				old.queue_free()
			g["act"] = act
			var part := _build(act)
			if part != null:
				root.add_child(part)
		_animate(g, c, act)
		_shield(g, shield)
		_aura(g, "ice", frozen)
		_aura(g, "glow", feather)
		_rope(g, c, act)
	for id in _gear.keys():
		if not seen.has(id):
			_drop(id)


## What is drawn for a critter right now, for tests: the act and whether a shield is up.
func state_of(id: int) -> Dictionary:
	var g: Dictionary = _gear.get(id, {})
	if g.is_empty():
		return {}
	return {
		"act": g["act"],
		"shield": g["shield"] != null,
		"rope": g["rope"] != null,
		"frozen": g["ice"] != null,
		"feather": g["glow"] != null,
	}


func clear() -> void:
	for id in _gear.keys():
		_drop(id)


func _drop(id: int) -> void:
	if not _gear.has(id):
		return
	var g: Dictionary = _gear[id]
	(g["root"] as Node).queue_free()
	if g["rope"] != null:
		(g["rope"] as Node).queue_free()
	_gear.erase(id)


func _build(act: String) -> Node3D:
	var part := Node3D.new()
	part.name = "Act"
	match act:
		"jetpack":
			for side in [-1.0, 1.0]:
				var can := MeshInstance3D.new()
				var mesh := CylinderMesh.new()
				mesh.top_radius = 0.5
				mesh.bottom_radius = 0.55
				mesh.height = 2.2
				can.mesh = mesh
				can.material_override = _mat(SODA, 0.25)
				can.position = Vector3(side * 0.7, 3.3, -1.5)
				part.add_child(can)
				var cap := MeshInstance3D.new()
				cap.mesh = _ball(0.5)
				cap.material_override = _mat(Color("f6e7c1"), 0.4)
				cap.position = Vector3(side * 0.7, 4.4, -1.5)
				part.add_child(cap)
				var plume := _plume()
				plume.name = "Plume%d" % int(side)
				plume.position = Vector3(side * 0.7, 2.1, -1.5)
				part.add_child(plume)
		"umbrella":
			var pole := MeshInstance3D.new()
			var pm := CylinderMesh.new()
			pm.top_radius = 0.1
			pm.bottom_radius = 0.1
			pm.height = 3.4
			pole.mesh = pm
			pole.material_override = _mat(Color("6b4a32"), 0.6)
			pole.position = Vector3(0, 7.7, 0)
			part.add_child(pole)
			var canopy := MeshInstance3D.new()
			canopy.name = "Canopy"
			var cm := CylinderMesh.new()
			cm.top_radius = 0.0
			cm.bottom_radius = 3.6
			cm.height = 1.5
			cm.radial_segments = 8
			canopy.mesh = cm
			canopy.material_override = _mat(Color("ff5a4a"), 0.5)
			canopy.position = Vector3(0, 9.6, 0)
			part.add_child(canopy)
			var tip := MeshInstance3D.new()
			tip.mesh = _ball(0.25)
			tip.material_override = _mat(Color("f6e7c1"), 0.4)
			tip.position = Vector3(0, 10.4, 0)
			part.add_child(tip)
		"boots":
			for side in [-1.0, 1.0]:
				var coil := Node3D.new()
				coil.name = "Coil%d" % int(side)
				coil.position = Vector3(side * 0.9, 0.0, 0.3)
				for i in 3:
					var ring := MeshInstance3D.new()
					var tm := TorusMesh.new()
					tm.inner_radius = 0.42
					tm.outer_radius = 0.62
					tm.rings = 10
					tm.ring_segments = 6
					ring.mesh = tm
					ring.material_override = _mat(
						Color("ffd23f") if i % 2 == 0 else Color("e8b84a"), 0.3
					)
					ring.position = Vector3(0, 0.25 + float(i) * 0.38, 0)
					coil.add_child(ring)
				part.add_child(coil)
		"drill":
			var bit := MeshInstance3D.new()
			bit.name = "Bit"
			var bm := CylinderMesh.new()
			bm.top_radius = 0.9
			bm.bottom_radius = 0.0
			bm.height = 1.8
			bm.radial_segments = 6
			bit.mesh = bm
			bit.material_override = _mat(Color("b8bcc4"), 0.2)
			bit.position = Vector3(0, 0.6, 0)
			part.add_child(bit)
			var dust := _dust()
			dust.name = "Dust"
			dust.position = Vector3(0, 0.4, 0)
			part.add_child(dust)
		"gatling":
			# A crank-handle pea shooter held out in front: three barrels round a hub.
			var gun := Node3D.new()
			gun.name = "Gun"
			gun.position = Vector3(0.0, 3.0, 2.0)
			var hub := MeshInstance3D.new()
			var hm := CylinderMesh.new()
			hm.top_radius = 0.55
			hm.bottom_radius = 0.55
			hm.height = 1.2
			hub.mesh = hm
			hub.rotation.x = PI * 0.5
			hub.material_override = _mat(Color("6b4a32"), 0.6)
			gun.add_child(hub)
			var barrels := Node3D.new()
			barrels.name = "Barrels"
			barrels.position = Vector3(0, 0, 1.4)
			for i in 3:
				var a := TAU * float(i) / 3.0
				var barrel := MeshInstance3D.new()
				var bm := CylinderMesh.new()
				bm.top_radius = 0.2
				bm.bottom_radius = 0.2
				bm.height = 2.2
				barrel.mesh = bm
				barrel.rotation.x = PI * 0.5
				barrel.position = Vector3(cos(a) * 0.38, sin(a) * 0.38, 0)
				barrel.material_override = _mat(Color("b8bcc4"), 0.2)
				barrels.add_child(barrel)
			gun.add_child(barrels)
			var crank := MeshInstance3D.new()
			crank.mesh = _ball(0.22)
			crank.position = Vector3(0.7, 0.5, -0.4)
			crank.material_override = _mat(Color("e8503c"), 0.4)
			gun.add_child(crank)
			var flash := MeshInstance3D.new()
			flash.name = "Flash"
			flash.mesh = _ball(0.5)
			flash.position = Vector3(0, 0, 2.7)
			var fm := StandardMaterial3D.new()
			Toon.shade(fm)
			fm.albedo_color = Color(0.7, 1.0, 0.55)
			fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			flash.material_override = fm
			gun.add_child(flash)
			part.add_child(gun)
		_:
			return null
	return part


func _animate(g: Dictionary, c: Dictionary, act: String) -> void:
	var part := (g["root"] as Node3D).get_node_or_null("Act") as Node3D
	if part == null:
		return
	match act:
		"umbrella":
			part.rotation.z = sin(_t * 2.4) * 0.07
		"boots":
			# Coils squash while on the ground and stretch in the air.
			var grounded := bool(c.get("grounded", true))
			for side in ["-1", "1"]:
				var coil := part.get_node_or_null("Coil" + side) as Node3D
				if coil != null:
					var goal := 0.55 if grounded else 1.35
					coil.scale.y = lerpf(coil.scale.y, goal, 0.25)
		"drill":
			var bit := part.get_node_or_null("Bit") as Node3D
			if bit != null:
				bit.rotation.y = _t * 22.0
		"gatling":
			var barrels := part.get_node_or_null("Gun/Barrels") as Node3D
			if barrels != null:
				barrels.rotation.z = _t * 26.0
			var flash := part.get_node_or_null("Gun/Flash") as Node3D
			if flash != null:
				flash.visible = fposmod(_t, 0.12) < 0.07
				flash.scale = Vector3.ONE * (0.8 + 0.5 * sin(_t * 90.0))
		"jetpack":
			var flying := not bool(c.get("grounded", true))
			for side in ["-1", "1"]:
				var plume := part.get_node_or_null("Plume" + side) as CPUParticles3D
				if plume != null:
					plume.emitting = flying


func _shield(g: Dictionary, on: bool) -> void:
	var bubble: MeshInstance3D = g["shield"]
	if not on:
		if bubble != null:
			bubble.queue_free()
			g["shield"] = null
		return
	if bubble == null:
		bubble = MeshInstance3D.new()
		bubble.name = "Shield"
		var sm := SphereMesh.new()
		sm.radius = 4.4
		sm.height = 8.8
		sm.radial_segments = 20
		sm.rings = 10
		bubble.mesh = sm
		var m := StandardMaterial3D.new()
		Toon.shade(m)
		m.albedo_color = Color(0.55, 0.85, 1.0, 0.22)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.emission_enabled = true
		m.emission = Color(0.5, 0.85, 1.0)
		m.emission_energy_multiplier = 0.6
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		bubble.material_override = m
		bubble.position = Vector3(0, 3.0, 0)
		(g["root"] as Node3D).add_child(bubble)
		g["shield"] = bubble
	bubble.scale = Vector3.ONE * (1.0 + 0.03 * sin(_t * 3.0))


## An ice shell round a frozen Squirmling, or a warm feather glow with rising sparkles.
func _aura(g: Dictionary, key: String, on: bool) -> void:
	var node: Node3D = g[key]
	if not on:
		if node != null:
			node.queue_free()
			g[key] = null
		return
	if node == null:
		node = _ice() if key == "ice" else _glow()
		(g["root"] as Node3D).add_child(node)
		g[key] = node
		# Switch the sparkles on only now: starting an emitter outside the tree reads its transform.
		var sparkles := node.get_node_or_null("Sparkles") as CPUParticles3D
		if sparkles != null:
			sparkles.emitting = true
	if key == "glow":
		node.scale = Vector3.ONE * (1.0 + 0.06 * sin(_t * 4.0))


static func _ice() -> Node3D:
	var shell := MeshInstance3D.new()
	shell.name = "Ice"
	var bm := BoxMesh.new()
	bm.size = Vector3(5.6, 7.4, 5.6)
	shell.mesh = bm
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.albedo_color = Color(0.7, 0.92, 1.0, 0.42)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.05
	m.metallic = 0.3
	m.emission_enabled = true
	m.emission = Color(0.55, 0.85, 1.0)
	m.emission_energy_multiplier = 0.5
	shell.material_override = m
	shell.position = Vector3(0, 3.3, 0)
	shell.rotation.y = 0.35
	# A few jagged crystals on top.
	for i in 3:
		var spike := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = 0.7
		cm.height = 2.2 + float(i) * 0.5
		cm.radial_segments = 5
		spike.mesh = cm
		spike.material_override = m
		spike.position = Vector3(float(i - 1) * 1.5, 3.7 + cm.height * 0.5, float(i % 2) - 0.5)
		spike.rotation.z = float(i - 1) * -0.3
		shell.add_child(spike)
	return shell


static func _glow() -> Node3D:
	var root := Node3D.new()
	root.name = "Glow"
	var aura := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 4.0
	sm.height = 8.0
	sm.radial_segments = 16
	sm.rings = 8
	aura.mesh = sm
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.albedo_color = Color(1.0, 0.92, 0.55, 0.2)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.emission_enabled = true
	m.emission = Color(1.0, 0.85, 0.4)
	m.emission_energy_multiplier = 0.8
	aura.material_override = m
	aura.position = Vector3(0, 3.0, 0)
	root.add_child(aura)
	var spark := _plume()
	spark.name = "Sparkles"
	spark.position = Vector3(0, 1.0, 0)
	spark.direction = Vector3.UP
	spark.spread = 40.0
	spark.initial_velocity_min = 2.0
	spark.initial_velocity_max = 4.0
	spark.lifetime = 1.2
	spark.amount = 14
	var fade := Gradient.new()
	fade.set_color(0, Color(1.0, 0.95, 0.6, 0.9))
	fade.set_color(1, Color(1.0, 0.95, 0.6, 0.0))
	spark.color_ramp = fade
	root.add_child(spark)
	return root


## The rope runs from the critter's chest to the anchor, in world space.
func _rope(g: Dictionary, c: Dictionary, act: String) -> void:
	var rope: MeshInstance3D = g["rope"]
	var anchor: Vector3 = c.get("anchor", Vector3.INF)
	if act != "rope" or anchor == Vector3.INF:
		if rope != null:
			rope.queue_free()
			g["rope"] = null
		return
	if rope == null:
		rope = MeshInstance3D.new()
		rope.name = "Rope"
		var cm := CylinderMesh.new()
		cm.top_radius = 0.12
		cm.bottom_radius = 0.12
		cm.height = 1.0
		cm.radial_segments = 5
		rope.mesh = cm
		rope.material_override = _mat(Color("c9a46a"), 0.9)
		var claw := MeshInstance3D.new()
		claw.name = "Claw"
		claw.mesh = _ball(0.5)
		claw.material_override = _mat(Color("b8bcc4"), 0.2)
		rope.add_child(claw)
		add_child(rope)
		g["rope"] = rope
	var from: Vector3 = (c["pos"] as Vector3) + Vector3(0, Squirmling.HEIGHT * 0.6, 0)
	var length := maxf(from.distance_to(anchor), 0.01)
	var dir := (anchor - from) / length
	var up := Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT
	# A cylinder runs along y; turn y onto the rope.
	var turned := (
		Basis.looking_at(dir, up)
		* Basis(Vector3.RIGHT, PI * 0.5)
		* Basis.from_scale(Vector3(1.0, length, 1.0))
	)
	rope.transform = Transform3D(turned, from.lerp(anchor, 0.5))
	# The claw sits at the far end at the far end whatever the rope's length (its parent is stretched).
	var claw := rope.get_node("Claw") as Node3D
	claw.position = Vector3(0, -0.5, 0)  # y runs back towards the critter after the turn
	claw.scale = Vector3(1.0, 1.0 / length, 1.0)


static func _mat(color: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.albedo_color = color
	m.roughness = rough
	return m


static func _ball(radius: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0
	s.radial_segments = 10
	s.rings = 5
	return s


## Fizzy soda bubbles blowing down out of a jetpack can.
static func _plume() -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.local_coords = false
	p.amount = 28
	p.lifetime = 0.55
	p.emitting = false
	p.direction = Vector3.DOWN
	p.spread = 14.0
	p.initial_velocity_min = 7.0
	p.initial_velocity_max = 11.0
	p.gravity = Vector3.ZERO
	p.mesh = _ball(0.28)
	var fade := Gradient.new()
	fade.set_color(0, FIZZ)
	fade.set_color(1, Color(FIZZ.r, FIZZ.g, FIZZ.b, 0.0))
	p.color_ramp = fade
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.5))
	curve.add_point(Vector2(1.0, 1.5))
	p.scale_amount_curve = curve
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	p.material_override = m
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p


## Earth thrown up by the drill hat while it tunnels.
static func _dust() -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.local_coords = false
	p.amount = 30
	p.lifetime = 0.7
	p.emitting = true
	p.direction = Vector3.UP
	p.spread = 70.0
	p.initial_velocity_min = 3.0
	p.initial_velocity_max = 7.0
	p.gravity = Vector3(0, -14, 0)
	p.mesh = _ball(0.4)
	var fade := Gradient.new()
	fade.set_color(0, DUST)
	fade.set_color(1, Color(DUST.r, DUST.g, DUST.b, 0.0))
	p.color_ramp = fade
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.7))
	curve.add_point(Vector2(1.0, 1.4))
	p.scale_amount_curve = curve
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	p.material_override = m
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p
