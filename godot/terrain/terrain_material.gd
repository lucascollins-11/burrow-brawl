## Builds the terrain ShaderMaterial (terrain.gdshader).
extends RefCounted


static func make(sea_y: float = 26.0, bedrock_y: float = 3.0) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = load("res://terrain/terrain.gdshader")
	mat.set_shader_parameter("sea_y", sea_y)
	mat.set_shader_parameter("bedrock_y", bedrock_y)
	return mat
