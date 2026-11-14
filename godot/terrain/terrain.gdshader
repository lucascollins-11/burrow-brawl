// Storybook terrain. World-space triplanar grain (no textures). Grass caps with a dark turf lip,
// warm soil on the upper cliffs, layered rock with bright bands lower down, wet sand and a foam
// ring at the waterline, blue-grey bedrock. Banded toon light with tinted shadows.
shader_type spatial;

uniform vec3 grass_color : source_color = vec3(0.42, 0.80, 0.20);
uniform vec3 grass_dark : source_color = vec3(0.24, 0.60, 0.16);
uniform vec3 grass_lip : source_color = vec3(0.18, 0.42, 0.20);
uniform vec3 soil_color : source_color = vec3(0.78, 0.50, 0.28);
uniform vec3 rock_color : source_color = vec3(0.56, 0.46, 0.42);
uniform vec3 rock_band : source_color = vec3(0.94, 0.75, 0.44);
uniform vec3 sand_color : source_color = vec3(0.95, 0.82, 0.54);
uniform vec3 bedrock_color : source_color = vec3(0.28, 0.30, 0.42);
uniform vec3 foam_color : source_color = vec3(1.0, 1.0, 1.0);
uniform vec3 shadow_tint : source_color = vec3(0.42, 0.35, 0.80);
uniform float sea_y = 26.0;
uniform float bedrock_y = 3.0;
uniform float grain_scale = 0.9;
uniform float grain_amount = 0.2;
uniform float strata_amount = 0.7;
uniform float strata_freq = 1.1;
uniform float lip_width = 0.18;
uniform float top_start = 0.60;
uniform float foam_amount = 1.0;
// Light steps across a lit face. 0 turns the banding off (smooth light).
uniform float bands = 3.0;

varying vec3 w_pos;
varying vec3 w_nrm;
// Material id from the mesher (vertex colour r = id / 255; no colour array reads as 255 = terrain).
varying flat float mat_id;

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
	float id = floor(COLOR.r * 255.0 + 0.5);
	mat_id = id > 15.5 ? 0.0 : id;
}

// ------------------------------------------------------------------ built structures
// One look per material id (shared/src/terrain3d/materials.ts). Patterns are drawn in world space
// on the face's own plane, so bricks, tiles and planks line up across voxels and chunks.

vec3 mat_color(int id) {
	if (id == 1) return vec3(0.95, 0.89, 0.76);  // plaster
	if (id == 2) return vec3(0.42, 0.26, 0.16);  // timber
	if (id == 3) return vec3(0.84, 0.40, 0.26);  // roof tile
	if (id == 4) return vec3(0.66, 0.66, 0.70);  // stone
	if (id == 5) return vec3(0.72, 0.32, 0.24);  // brick
	if (id == 6) return vec3(0.78, 0.60, 0.38);  // planks
	if (id == 7) return vec3(0.88, 0.24, 0.22);  // red paint
	if (id == 8) return vec3(0.97, 0.96, 0.93);  // white paint
	if (id == 9) return vec3(0.62, 0.86, 0.96);  // glass
	if (id == 10) return vec3(0.34, 0.39, 0.52); // slate
	if (id == 11) return vec3(0.60, 0.57, 0.55); // cobble
	if (id == 12) return vec3(0.30, 0.33, 0.38); // metal
	if (id == 13) return vec3(0.88, 0.72, 0.38); // thatch
	if (id == 14) return vec3(0.33, 0.56, 0.86); // blue paint
	return vec3(0.99, 0.81, 0.30);               // yellow paint
}

// Mortar lines of a running-bond pattern: 0 in the joint, 1 on the face of a unit.
float bond(vec2 uv, vec2 unit, float joint, out vec2 cell) {
	float row = floor(uv.y / unit.y);
	vec2 q = vec2(uv.x / unit.x + 0.5 * mod(row, 2.0), uv.y / unit.y);
	cell = floor(q);
	vec2 f = fract(q);
	vec2 jt = joint / unit;
	vec2 e = smoothstep(vec2(0.0), jt, f) * smoothstep(vec2(0.0), jt, 1.0 - f);
	return e.x * e.y;
}

vec3 structure_albedo(int id, vec3 pos, vec3 n, out float rough, out float spec, out float emit) {
	rough = 0.8;
	spec = 0.15;
	emit = 0.0;
	vec3 an = abs(n);
	bool top = an.y > 0.7;
	// The face's own 2D coordinates: horizontal run, then up (or x/z on tops).
	vec2 uv = top ? pos.xz : (an.x > an.z ? vec2(pos.z, pos.y) : vec2(pos.x, pos.y));
	vec3 flat_c = mat_color(id);
	vec3 c = flat_c;
	// Fade fine patterns out with distance so far-off walls do not shimmer.
	float detail = 1.0 - smoothstep(0.12, 0.45, length(fwidth(uv)));
	float mottle = vnoise(uv * 1.3) * 0.6 + vnoise(uv * 4.1) * 0.4;
	vec2 cell;
	if (id == 4 || id == 11) {
		// Stone: big blocks; cobble on tops is small rounded setts.
		vec2 unit = (id == 11 && top) ? vec2(0.75, 0.75) : vec2(1.3, 0.66);
		float f = bond(uv, unit, 0.09, cell);
		float tint = hash21(cell + float(id));
		c *= 0.82 + 0.3 * tint;
		c = mix(c * 0.55, c, f);
	} else if (id == 5) {
		float f = bond(uv, vec2(0.66, 0.33), 0.05, cell);
		c *= 0.85 + 0.25 * hash21(cell);
		c = mix(vec3(0.86, 0.82, 0.74), c, f);
	} else if (id == 3 || id == 10) {
		// Tiles: overlapping rows, each darker toward its lower edge, staggered joints.
		vec2 tuv = top ? vec2(pos.x + pos.z * 0.0, pos.z) : uv;
		float rows = id == 3 ? 0.5 : 0.4;
		float r = fract(tuv.y / rows);
		float joint = bond(tuv, vec2(id == 3 ? 0.5 : 0.6, rows), 0.04, cell);
		c *= 0.88 + 0.22 * hash21(cell * 1.7);
		c *= mix(0.72, 1.0, smoothstep(0.0, 0.35, r));
		c = mix(c * 0.7, c, joint);
		spec = id == 10 ? 0.3 : 0.18;
	} else if (id == 6 || id == 2) {
		// Planks and beams: boards along the longer axis with grain and dark gaps.
		float along = top ? uv.x : uv.x;
		float across = top ? uv.y : uv.y;
		float w = id == 6 ? 0.33 : 0.5;
		float board = floor(across / w);
		float gap = smoothstep(0.0, 0.07, fract(across / w)) * smoothstep(0.0, 0.07, 1.0 - fract(across / w));
		float grain_l = vnoise(vec2(along * 0.7, across * 9.0 + board * 3.1));
		c *= 0.82 + 0.3 * hash21(vec2(board, float(id))) + 0.12 * (grain_l - 0.5);
		c = mix(c * 0.45, c, gap);
	} else if (id == 13) {
		float streak = vnoise(vec2(uv.x * 9.0, uv.y * 0.8));
		c *= 0.75 + 0.45 * streak;
	} else if (id == 9) {
		// Glass: panes in metal frames, a bright sky reflection band.
		vec2 g = fract(uv * vec2(1.0, 0.5));
		float frame = step(0.92, max(g.x, g.y)) + step(max(1.0 - g.x, 1.0 - g.y), 0.08);
		float sheen = smoothstep(0.3, 0.7, fract((uv.x + uv.y) * 0.35));
		c = mix(c + sheen * 0.15, vec3(0.25, 0.27, 0.3), clamp(frame, 0.0, 1.0));
		rough = 0.1;
		spec = 0.8;
		emit = 0.15;
	} else if (id == 12) {
		float rivet = step(0.88, hash21(floor(uv * 2.0))) * step(length(fract(uv * 2.0) - 0.5), 0.12);
		c *= 0.9 + 0.2 * mottle - 0.25 * rivet;
		rough = 0.45;
		spec = 0.5;
	} else {
		// Plaster and paint: soft mottling and a little weathering low down.
		c *= 0.92 + 0.12 * mottle;
		float grime = 1.0 - smoothstep(0.0, 2.5, fract(pos.y / 11.0) * 11.0);
		c *= 1.0 - 0.06 * grime;
	}
	return mix(flat_c * (0.92 + 0.1 * mottle), c, detail);
}


void fragment() {
	int mid = int(mat_id + 0.5);
	if (mid > 0) {
		// Structures are faceted: the face normal from screen-space derivatives keeps hard edges.
		vec3 fn = normalize(cross(dFdx(w_pos), dFdy(w_pos)));
		if (dot(fn, w_nrm) < 0.0) fn = -fn;
		float rough;
		float spec;
		float emit;
		vec3 c = structure_albedo(mid, w_pos, fn, rough, spec, emit);
		c *= mix(1.0, 0.7, 1.0 - smoothstep(-0.85, -0.1, fn.y));
		NORMAL = normalize((VIEW_MATRIX * vec4(fn, 0.0)).xyz);
		ALBEDO = c;
		ROUGHNESS = rough;
		SPECULAR = spec;
		EMISSION = c * emit;
		RIM = 0.2;
		RIM_TINT = 0.5;
	} else {
	vec3 n = normalize(w_nrm);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 p = w_pos * grain_scale;
	float g = grain(p.zy) * w.x + grain(p.xz) * w.y + grain(p.xy) * w.z;

	// Big soft patches break up the grass.
	float blotch = vnoise(w_pos.xz * 0.11);
	vec3 grass = mix(grass_dark, grass_color, smoothstep(0.25, 0.75, blotch));

	// Sides: soil near the top of the island, rock lower, wavy strata and a few bright bands.
	float height_above_sea = w_pos.y - sea_y;
	float soil_amount = smoothstep(-2.0, 10.0, height_above_sea);
	float wave = vnoise(w_pos.xz * 0.15) * 3.0;
	float strata = 0.5 + 0.5 * sin(w_pos.y * strata_freq + wave);
	float band = smoothstep(0.82, 0.9, 0.5 + 0.5 * sin(w_pos.y * strata_freq * 0.37 + wave * 0.5));
	vec3 side = mix(rock_color, soil_color, soil_amount);
	side = mix(side, side * 0.80, strata * strata_amount);
	side = mix(side, rock_band, band * 0.6);

	float top = smoothstep(top_start, top_start + 0.2, n.y);
	// A darker lip where the grass cap meets the cliff, like a turf edge.
	float lip = smoothstep(top_start - lip_width, top_start, n.y) * (1.0 - top);
	vec3 base = mix(side, grass, top);
	base = mix(base, grass_lip, lip * step(0.001, lip_width));

	// Beach: sand around and just under the waterline on gentle slopes.
	float beach = (1.0 - smoothstep(sea_y + 0.6, sea_y + 3.2, w_pos.y)) * smoothstep(0.15, 0.65, n.y);
	base = mix(base, sand_color, beach);

	// Foam ring at the waterline.
	float foam = (1.0 - smoothstep(0.0, 0.9, abs(w_pos.y - sea_y - 0.3))) * foam_amount;
	foam *= 0.6 + 0.4 * vnoise(w_pos.xz * 0.8);
	base = mix(base, foam_color, clamp(foam, 0.0, 1.0));

	// Under the soda it gets cooler and darker.
	float submerged = 1.0 - smoothstep(sea_y - 7.0, sea_y + 0.2, w_pos.y);
	base = mix(base, base * vec3(0.50, 0.72, 0.80), submerged);

	// Bedrock band at the bottom of the map.
	float bedrock = 1.0 - smoothstep(bedrock_y + 0.5, bedrock_y + 5.0, w_pos.y);
	base = mix(base, bedrock_color, bedrock);

	// Undersides of overhangs sit in shadow.
	base *= mix(1.0, 0.68, 1.0 - smoothstep(-0.85, -0.1, n.y));

	ALBEDO = base * (1.0 - grain_amount * 0.5 + grain_amount * g);
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	}
}

void light() {
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float lit = ndl;
	if (bands > 0.5) {
		lit = mix(floor(ndl * bands + 0.5) / bands, ndl, 0.25);
	}
	lit *= ATTENUATION;
	// Shadows lean toward the tint instead of going grey.
	vec3 shade = mix(shadow_tint * 0.25, vec3(1.0), lit);
	DIFFUSE_LIGHT += shade * LIGHT_COLOR / PI;
}
