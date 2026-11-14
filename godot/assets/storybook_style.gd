## Turns any imported third-party model (glTF, glb, obj) into the game's Storybook look, so library
## assets read as ours: toon-banded light like the terrain and the Squirmlings, no photo detail
## (normal, roughness and metal maps are dropped), and colours pushed toward a painted palette.
##
##   var lamp := StorybookStyle.instance("res://assets/thirdparty/polyhaven/Lantern_01/Lantern_01.gltf")
##   StorybookStyle.restyle(node, {"flat": false, "tint": Color("ffe9c4")})
##
## Options: flat (default true: one painted colour per material, the texture's average),
## saturation (default 1.15), tint (multiplies the colour), height (scale the model to this many
## world units tall; a Squirmling is 6), crisp (default true: no rim glow, for buildings).
extends RefCounted

const Toon := preload("res://game/toon.gd")

static var _cache: Dictionary = {}


## Load a model, restyle it and return a fresh node. Null when the file can't be loaded.
static func instance(path: String, opts := {}) -> Node3D:
	var res: Resource = load(path)
	var node: Node3D = null
	if res is PackedScene:
		node = (res as PackedScene).instantiate() as Node3D
	elif res is Mesh:
		var mi := MeshInstance3D.new()
		mi.mesh = res
		node = mi
	if node == null:
		push_error("storybook_style: can't load %s" % path)
		return null
	restyle(node, opts)
	if opts.has("height"):
		var box := bounds(node)
		if box.size.y > 0.0:
			node.scale = Vector3.ONE * (float(opts["height"]) / box.size.y)
	return node


## Swap every surface material under `root` for a Storybook one. Returns how many surfaces changed.
static func restyle(root: Node, opts := {}) -> int:
	var count := 0
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		stack.append_array(n.get_children())
		var mi := n as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var src := mi.get_active_material(i)
			mi.set_surface_override_material(i, material_for(src, opts))
			count += 1
	return count


## The Storybook version of one material. Shared between models with the same source and options.
static func material_for(src: Material, opts := {}) -> StandardMaterial3D:
	var key := "%s/%s" % [src.get_instance_id() if src != null else 0, JSON.stringify(opts)]
	if _cache.has(key):
		return _cache[key]
	var color := Color(0.8, 0.8, 0.8)
	var tex: Texture2D = null
	var base := src as BaseMaterial3D
	if base != null:
		color = base.albedo_color
		tex = base.albedo_texture
	var m := StandardMaterial3D.new()
	Toon.shade(m)
	m.roughness = 1.0
	m.metallic = 0.0
	m.metallic_specular = 0.2
	var flat := bool(opts.get("flat", true))
	var cutout := base != null and tex != null and base.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
	if cutout:
		# Leaf cards need the texture for their outline: keep it, but scale it so it averages to
		# the painted colour instead of the photo's.
		var avg := average_color(tex)
		var want := painted(color * avg, float(opts.get("saturation", 1.15)))
		m.albedo_texture = tex
		color = Color(
			want.r / maxf(avg.r, 0.05), want.g / maxf(avg.g, 0.05), want.b / maxf(avg.b, 0.05)
		)
	elif tex != null and flat:
		color *= average_color(tex)
	elif tex != null:
		m.albedo_texture = tex
	if not cutout:
		color = painted(color, float(opts.get("saturation", 1.15)))
	if opts.has("tint"):
		color *= Color(opts["tint"])
	m.albedo_color = Color(color, 1.0)
	if cutout:
		# Scissor, not blending: hundreds of leaves sort badly when blended.
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = maxf(base.alpha_scissor_threshold, 0.4)
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	elif base != null and base.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color.a = base.albedo_color.a
	if not bool(opts.get("crisp", true)):
		m.rim_enabled = true
		m.rim = 0.3
		m.rim_tint = 0.5
	_cache[key] = m
	return m


## A texture's average colour (what it reads as from game distance).
static func average_color(tex: Texture2D) -> Color:
	var img := tex.get_image()
	if img == null or img.is_empty():
		return Color.WHITE
	img = img.duplicate()
	if img.is_compressed():
		img.decompress()
	img.resize(16, 16, Image.INTERPOLATE_BILINEAR)
	# Weighted by alpha, so the empty parts of a leaf card don't darken its colour.
	var sum := Color(0, 0, 0, 0)
	var weight := 0.0
	for y in 16:
		for x in 16:
			var p := img.get_pixel(x, y)
			sum += Color(p.r, p.g, p.b) * p.a
			weight += p.a
	if weight <= 0.0:
		return Color.WHITE
	return Color(sum.r / weight, sum.g / weight, sum.b / weight)


## Push a colour toward a painted palette: more saturated, lifted out of the darks.
static func painted(c: Color, saturation: float) -> Color:
	var out := Color.from_hsv(c.h, clampf(c.s * saturation, 0.0, 1.0), clampf(0.28 + c.v * 0.8, 0.0, 1.0))
	out.a = c.a
	return out


## The model's bounding box in its own space, over every mesh below it.
static func bounds(root: Node3D) -> AABB:
	var box := AABB()
	var first := true
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		stack.append_array(n.get_children())
		var mi := n as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var p: Node = mi
		while p != root and p is Node3D:
			xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var b := xf * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box
