## Builds the terrain ShaderMaterial (terrain.gdshader).
extends RefCounted


static func make(sea_y: float = 26.0) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = load("res://terrain/terrain.gdshader")
	mat.set_shader_parameter("sea_y", sea_y)
	return mat
