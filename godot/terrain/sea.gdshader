// Soda sea: a fizzy translucent surface with foam where it meets the ground, gentle swells, and a
// fade into the horizon colour with distance. Needs the Forward+ or Mobile renderer (depth texture).
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, specular_schlick_ggx;

uniform vec3 deep_color : source_color = vec3(0.06, 0.42, 0.55);
uniform vec3 shallow_color : source_color = vec3(0.42, 0.95, 0.78);
uniform vec3 foam_color : source_color = vec3(1.0, 1.0, 1.0);
uniform vec3 horizon_color : source_color = vec3(1.0, 0.76, 0.58);
uniform float horizon_start = 140.0;
uniform float horizon_end = 900.0;
uniform float depth_fade = 7.0;
uniform float foam_width = 1.6;
uniform float wave_height = 0.35;
uniform float fizz_density = 0.9;

uniform sampler2D depth_tex : hint_depth_texture, repeat_disable, filter_nearest;

varying vec3 w_pos;

float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float swell(vec2 p, float t) {
	return sin(p.x * 0.30 + t * 1.1) * 0.5 + sin(p.y * 0.23 - t * 0.8) * 0.3
		+ sin((p.x + p.y) * 0.11 + t * 0.6) * 0.2;
}

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	VERTEX.y += swell(wp.xz, TIME) * wave_height;
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	// How much water is between this surface and whatever is behind it.
	float depth_raw = texture(depth_tex, SCREEN_UV).r;
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, depth_raw);
	vec4 view_pos = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	view_pos.xyz /= view_pos.w;
	float water_depth = max(0.0, -view_pos.z + VERTEX.z);

	float shallow = 1.0 - clamp(water_depth / depth_fade, 0.0, 1.0);
	vec3 col = mix(deep_color, shallow_color, shallow);

	// Shoreline foam: a wobbling band where the water gets very shallow.
	float wobble = sin(w_pos.x * 0.9 + TIME * 1.5) * 0.25 + sin(w_pos.z * 1.1 - TIME * 1.1) * 0.25;
	float foam = 1.0 - smoothstep(0.0, foam_width, water_depth + wobble * 0.4);
	foam *= 0.85 + 0.15 * sin(TIME * 2.0 + w_pos.x * 0.4);

	// Fizz: little bubbles that grow and fade in cells across the surface.
	vec2 g = w_pos.xz * 1.5;
	vec2 cell = floor(g);
	float r = hash21(cell);
	float phase = fract(TIME * (0.25 + r * 0.45) + r * 7.0);
	vec2 centre = vec2(0.5) + (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.5;
	float bubble = 1.0 - smoothstep(0.0, 0.14, length(fract(g) - centre));
	bubble *= step(1.0 - fizz_density * 0.2, r) * sin(phase * 3.14159);

	col = mix(col, foam_color, clamp(foam + bubble * 0.8, 0.0, 1.0));

	// Fade to the horizon colour far from the camera.
	float dist = length(w_pos.xz - CAMERA_POSITION_WORLD.xz);
	float haze = smoothstep(horizon_start, horizon_end, dist);
	col = mix(col, horizon_color, haze);

	float alpha = mix(0.93, 0.50, shallow);
	alpha = clamp(alpha + foam * 0.4 + bubble * 0.3, 0.0, 1.0);
	alpha = mix(alpha, 1.0, haze);

	ALBEDO = col;
	ALPHA = alpha;
	ROUGHNESS = 0.12;
	METALLIC = 0.0;
	SPECULAR = 0.7;
	EMISSION = foam_color * (bubble * 0.25 + foam * 0.05);
}
