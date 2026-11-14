## Storybook shading for meshes with StandardMaterial3D (Squirmlings, hats, crates, effects):
## banded toon diffuse and a small hard highlight, so they match the toon-lit terrain.
## Unshaded materials (flashes, glows) ignore it.
extends RefCounted


static func shade(m: BaseMaterial3D) -> BaseMaterial3D:
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
	m.specular_mode = BaseMaterial3D.SPECULAR_TOON
	return m
