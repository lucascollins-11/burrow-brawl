class_name WeaponIcons
extends Node
## Bakes one small picture per weapon from the in-game toy models (WeaponIconModels), lit with
## the storybook toon look and an ink outline, in a single reused offscreen SubViewport. Pictures
## are cached for the whole run. With no renderer (headless tests) nothing is baked and callers
## keep their fallback.

signal baked(id: String)

const SIZE := 128
const INK := Color("#2a1d12")

static var cache: Dictionary = {}  # id -> Texture2D

var _queue: Array[String] = []
var _running := false


## The picture for a weapon, or null while it is not baked yet.
static func get_icon(id: String) -> Texture2D:
	return cache.get(id)


## Queue weapons for baking (ones already done are skipped).
func request(ids: Array) -> void:
	for id in ids:
		var s := str(id)
		if not cache.has(s) and not _queue.has(s):
			_queue.append(s)
	if not _running and not _queue.is_empty() and can_render():
		_run()


static func can_render() -> bool:
	return DisplayServer.get_name() != "headless"


func _run() -> void:
	_running = true
	var vp := SubViewport.new()
	vp.size = Vector2i(SIZE, SIZE)
	vp.transparent_bg = true
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	var cam := Camera3D.new()
	cam.fov = 30.0
	vp.add_child(cam)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.1
	sun.rotation_degrees = Vector3(-40, -35, 0)
	vp.add_child(sun)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(1.0, 0.95, 0.88)
	env.ambient_light_energy = 0.75
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	while not _queue.is_empty() and is_inside_tree():
		var id: String = _queue.pop_front()
		var model := WeaponIconModels.make(id)
		if model == null:
			continue
		_outline(model)
		vp.add_child(model)
		_frame(cam, model)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var img := vp.get_texture().get_image()
		vp.remove_child(model)
		model.queue_free()
		if img != null and not img.is_empty():
			cache[id] = ImageTexture.create_from_image(img)
			baked.emit(id)
	vp.queue_free()
	_running = false


## Ink outline: a front-culled, slightly grown copy of every mesh's material as next_pass. The
## shared cached materials are duplicated first so the in-game shots stay unchanged.
static func _outline(node: Node) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			var ink := StandardMaterial3D.new()
			ink.albedo_color = INK
			ink.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			ink.cull_mode = BaseMaterial3D.CULL_FRONT
			ink.grow = true
			ink.grow_amount = 0.025
			for s in mi.mesh.get_surface_count():
				var base := mi.get_active_material(s)
				var m: Material = base.duplicate() if base != null else StandardMaterial3D.new()
				if m is BaseMaterial3D and (m as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
					m.next_pass = ink
				mi.set_surface_override_material(s, m)
	for c in node.get_children():
		_outline(c)


static func _bounds(node: Node, xf: Transform3D, acc: Array) -> void:
	if node is Node3D and node != null:
		xf = xf * (node as Node3D).transform
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		var bb: AABB = xf * (node as MeshInstance3D).mesh.get_aabb()
		acc[0] = bb if acc[0] == null else (acc[0] as AABB).merge(bb)
	for c in node.get_children():
		_bounds(c, xf, acc)


func _frame(cam: Camera3D, model: Node3D) -> void:
	var acc: Array = [null]
	_bounds(model, Transform3D.IDENTITY, acc)
	var bb: AABB = acc[0] if acc[0] != null else AABB(Vector3(-0.5, -0.5, -0.5), Vector3.ONE)
	var center := bb.get_center()
	var radius := maxf(bb.size.length() * 0.5, 0.1)
	var dist := radius / sin(deg_to_rad(cam.fov * 0.5)) * 0.95
	var dir := Vector3(0.55, 0.45, 1.0).normalized()
	cam.position = center + dir * dist
	cam.look_at_from_position(cam.position, center, Vector3.UP)
	cam.near = 0.02
	cam.far = dist * 4.0
