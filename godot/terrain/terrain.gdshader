// Toy-clay terrain. World-space triplanar grain (no textures). Grass on upward faces, warm soil on
// the upper cliffs, cooler layered rock lower down, wet sand at the waterline, blue-grey bedrock.
shader_type spatial;

uniform vec3 grass_color : source_color = vec3(0.42, 0.80, 0.20);
uniform vec3 grass_dark : source_color = vec3(0.24, 0.60, 0.16);
uniform vec3 soil_color : source_color = vec3(0.78, 0.50, 0.28);
uniform vec3 rock_color : source_color = vec3(0.56, 0.46, 0.42);
uniform vec3 sand_color : source_color = vec3(0.95, 0.82, 0.54);
uniform vec3 bedrock_color : source_color = vec3(0.28, 0.30, 0.42);
uniform float sea_y = 26.0;
uniform float bedrock_y = 3.0;
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

	// Big soft patches break up the grass; small grain reads as fingerprints in clay.
	float blotch = vnoise(w_pos.xz * 0.11);
	vec3 grass = mix(grass_dark, grass_color, smoothstep(0.25, 0.75, blotch));

	// Sides: soil near the top of the island, rock lower, with wavy strata bands.
	float height_above_sea = w_pos.y - sea_y;
	float soil_amount = smoothstep(-2.0, 10.0, height_above_sea);
	float strata = 0.5 + 0.5 * sin(w_pos.y * 0.9 + vnoise(w_pos.xz * 0.15) * 3.0);
	vec3 side = mix(rock_color, soil_color, soil_amount);
	side = mix(side, side * 0.80, strata * 0.55);

	float top = smoothstep(0.60, 0.80, n.y);
	vec3 base = mix(side, grass, top);

	// Beach: sand around and just under the waterline on gentle slopes.
	float beach = (1.0 - smoothstep(sea_y + 0.6, sea_y + 3.2, w_pos.y)) * smoothstep(0.15, 0.65, n.y);
	base = mix(base, sand_color, beach);

	// Under the soda it gets cooler and darker.
	float submerged = 1.0 - smoothstep(sea_y - 7.0, sea_y + 0.2, w_pos.y);
	base = mix(base, base * vec3(0.50, 0.72, 0.80), submerged);

	// Bedrock band at the bottom of the map.
	float bedrock = 1.0 - smoothstep(bedrock_y + 0.5, bedrock_y + 5.0, w_pos.y);
	base = mix(base, bedrock_color, bedrock);

	// Undersides of overhangs sit in shadow.
	base *= mix(1.0, 0.68, 1.0 - smoothstep(-0.85, -0.1, n.y));

	ALBEDO = base * (0.86 + 0.28 * g);
	ROUGHNESS = 0.85;
	SPECULAR = 0.12;
	RIM = 0.25;
	RIM_TINT = 0.5;
}
