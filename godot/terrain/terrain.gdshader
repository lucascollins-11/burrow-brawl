// Toy-clay terrain: world-space triplanar grain, grass on tops, rock on sides, sand under the sea.
shader_type spatial;

uniform vec3 grass_color : source_color = vec3(0.42, 0.78, 0.22);
uniform vec3 rock_color : source_color = vec3(0.72, 0.52, 0.34);
uniform vec3 sand_color : source_color = vec3(0.93, 0.80, 0.52);
uniform float sea_y = 26.0;
uniform float grain_scale = 0.9;

varying vec3 w_pos;
varying vec3 w_nrm;

float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
		mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
		f.y);
}

float grain(vec2 p) {
	return vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.4;
}

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(w_nrm);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 p = w_pos * grain_scale;
	float g = grain(p.zy) * w.x + grain(p.xz) * w.y + grain(p.xy) * w.z;

	float top = smoothstep(0.55, 0.85, n.y);
	vec3 base = mix(rock_color, grass_color, top);
	// Banding on cliffs reads as layered clay.
	float band = 0.5 + 0.5 * sin(w_pos.y * 0.8 + g * 2.0);
	base = mix(base, base * 0.82, (1.0 - top) * band * 0.5);
	// Sand near and below the waterline.
	float wet = 1.0 - smoothstep(sea_y + 0.5, sea_y + 3.5, w_pos.y);
	base = mix(base, sand_color, wet * smoothstep(0.2, 0.7, n.y + 0.2));
	ALBEDO = base * (0.85 + 0.3 * g);
	ROUGHNESS = 0.85;
	SPECULAR = 0.15;
}
