// Storybook scenery (props scattered by Scenery): one colour per instance, toon-banded light with
// tinted shadows like the terrain, and an optional sway for grass, flowers and leaves.
// INSTANCE_CUSTOM: x = sway amount, y = the prop's ground height, z = phase.
shader_type spatial;
render_mode world_vertex_coords;

uniform vec3 shadow_tint : source_color = vec3(0.42, 0.35, 0.80);
uniform float bands = 3.0;
uniform vec2 wind = vec2(0.6, 0.35);

varying vec3 tint;

void vertex() {
	tint = COLOR.rgb;
	float amount = INSTANCE_CUSTOM.x;
	if (amount > 0.0) {
		float h = max(VERTEX.y - INSTANCE_CUSTOM.y, 0.0);
		float t = TIME * 1.7 + INSTANCE_CUSTOM.z * 6.283 + VERTEX.x * 0.05 + VERTEX.z * 0.04;
		float gust = sin(t) * 0.7 + sin(t * 2.3 + 1.1) * 0.3;
		VERTEX.xz += wind * gust * amount * h * h * 0.06;
	}
}

void fragment() {
	ALBEDO = tint;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}

void light() {
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float lit = ndl;
	if (bands > 0.5) {
		lit = mix(floor(ndl * bands + 0.5) / bands, ndl, 0.25);
	}
	lit *= ATTENUATION;
	vec3 shade = mix(shadow_tint * 0.25, vec3(1.0), lit);
	DIFFUSE_LIGHT += shade * LIGHT_COLOR / PI;
}
