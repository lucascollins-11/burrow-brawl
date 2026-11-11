## Builds the soda-sea ShaderMaterial (sea.gdshader). Put it on a big horizontal plane at the sea
## level, for example `sea.material_override = SeaMaterial.make()`. The look can be changed with
## the optional colours; the defaults are a bright lime-teal soda fading to a sunset horizon.
extends RefCounted


static func make(
	shallow: Color = Color(0.42, 0.95, 0.78),
	deep: Color = Color(0.06, 0.42, 0.55),
	horizon: Color = Color(1.0, 0.76, 0.58)
) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = load("res://terrain/sea.gdshader")
	mat.set_shader_parameter("shallow_color", shallow)
	mat.set_shader_parameter("deep_color", deep)
	mat.set_shader_parameter("horizon_color", horizon)
	return mat
