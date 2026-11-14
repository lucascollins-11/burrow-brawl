class_name MapLook
extends RefCounted
## The colours of a map theme: ground, sea, sky and light. The server only names the theme
## (`config.map.theme` in match.start); everything about how it looks lives here. Unknown themes
## get the Picnic Atoll look, so a newer server never breaks an older client.

const DEFAULT := "picnic-atoll"

const LOOKS := {
	# A sunny picnic at sunset: grass, warm soil, lime soda.
	"picnic-atoll": {
		"grass": "6bcc33", "grass_dark": "3d9929", "soil": "c78047", "rock": "8f756b",
		"sand": "f2d18a", "bedrock": "474d6b",
		"sea_shallow": "6bf2c7", "sea_deep": "0f6b8c", "sea_horizon": "ffc294",
		"sky_top": "4f8fd8", "sky_horizon": "ffb27a", "sky_bottom": "c46a5a",
		"sun": "ffd9a8", "sun_energy": 1.5, "sun_pitch": -38.0, "fog": "ffc79a",
		"cloud": "fff3e6", "debris": "8b5a2b",
	},
	# Painted wooden blocks in a bathtub harbour: play-mat tops, red and blue sides, clear noon.
	"toybox-harbor": {
		"grass": "f4c542", "grass_dark": "e59a2e", "soil": "d9503f", "rock": "3f7fc4",
		"sand": "fbe9b8", "bedrock": "2d3a66",
		"sea_shallow": "8fe8ff", "sea_deep": "1f63b5", "sea_horizon": "d6f1ff",
		"sky_top": "3f8fe8", "sky_horizon": "cfeaff", "sky_bottom": "8fb6d9",
		"sun": "fff4d6", "sun_energy": 1.6, "sun_pitch": -52.0, "fog": "dff1ff",
		"cloud": "ffffff", "debris": "d9503f",
		"saturation": 1.12,
	},
	# Brass and copper under a violet dusk.
	"clockwork-mesa": {
		"grass": "c9a23a", "grass_dark": "9c7a2b", "soil": "b5673a", "rock": "6d5a52",
		"sand": "e3c58f", "bedrock": "33303f",
		"sea_shallow": "9ad6c9", "sea_deep": "24506b", "sea_horizon": "e8a6b8",
		"sky_top": "4a3f8c", "sky_horizon": "f09a7a", "sky_bottom": "7a4a6b",
		"sun": "ffc48a", "sun_energy": 1.45, "sun_pitch": -28.0, "fog": "e8a6a0",
		"cloud": "ffd9c9", "debris": "9c7a2b",
		"saturation": 1.2,
	},
	# A sunny vegetable patch: bright lawn, dark soil, terracotta pots, a green pond.
	"garden-patch": {
		# Storybook palette (the look Lucas picked): violet rock with gold bands, a dark turf lip.
		"grass": "8be04e", "grass_dark": "45b04a", "grass_lip": "2f7a3a", "soil": "c8794a",
		"rock": "8a6a8f", "rock_band": "f0c070", "sand": "ffe3a3", "bedrock": "3e3b34",
		"sea_shallow": "8fe0b0", "sea_deep": "1f7a6a", "sea_horizon": "d8f2c8",
		"sky_top": "5aa8e8", "sky_horizon": "ffe9b0", "sky_bottom": "a8d08a",
		"sun": "fff0cc", "sun_energy": 1.5, "sun_pitch": -40.0, "sun_yaw": 200.0, "fog": "e6f2c8",
		"cloud": "ffffff", "debris": "7a4a2e",
		"saturation": 1.3,
	},
	# Soap bars and a sponge in a steamy bathtub: porcelain blues, pink foam, warm light.
	"bathtub-bay": {
		"grass": "f7b6d6", "grass_dark": "c9a3ea", "soil": "fbd9a4", "rock": "a6c4f2",
		"sand": "d9b04e", "bedrock": "5a5f8c",
		"sea_shallow": "7fd4f2", "sea_deep": "1c63b0", "sea_horizon": "d6efff",
		"sky_top": "7fc8f8", "sky_horizon": "fff1e0", "sky_bottom": "d6ecf5",
		"sun": "fff6e0", "sun_energy": 1.5, "sun_pitch": -50.0, "fog": "e6f7ff",
		"cloud": "ffffff", "debris": "f4e4f0",
		"saturation": 1.08,
	},
	# A fishing village at dusk: low golden sun, deep harbour blue, slate and stone, lush terraces.
	"lighthouse-village": {
		"grass": "7fd04a", "grass_dark": "3f9a40", "grass_lip": "2f7a3a", "soil": "b8774a",
		"rock": "8a7f8f", "rock_band": "e8b878", "sand": "f5d9a0", "bedrock": "3a3f4f",
		"sea_shallow": "5fd0c8", "sea_deep": "0f4f7a", "sea_horizon": "ffb88a",
		"sky_top": "3f6fc8", "sky_horizon": "ffa870", "sky_bottom": "b8607a",
		"sun": "ffc890", "sun_energy": 1.35, "sun_pitch": -22.0, "sun_yaw": 230.0, "fog": "f2b896",
		"cloud": "ffe2d0", "debris": "7a5a46",
		"saturation": 1.15,
	},
	# Icing on sponge cake in strawberry soda.
	"frosted-bakery": {
		"grass": "fff6f0", "grass_dark": "ffd6e3", "soil": "e8b56b", "rock": "b5763f",
		"sand": "fff0c9", "bedrock": "6b3f33",
		"sea_shallow": "ffc2d6", "sea_deep": "c2477a", "sea_horizon": "ffe3d6",
		"sky_top": "8fc2f2", "sky_horizon": "ffe0ea", "sky_bottom": "f2b5c7",
		"sun": "fff0e0", "sun_energy": 1.5, "sun_pitch": -45.0, "fog": "ffe6ee",
		"cloud": "ffffff", "debris": "e8b56b",
		"saturation": 1.08,
	},
}


static func for_theme(id: String) -> Dictionary:
	return LOOKS.get(id, LOOKS[DEFAULT])


## The theme id from a view match.start, or the default when the server sent none.
static func theme_of(msg: Dictionary) -> String:
	var config: Dictionary = msg.get("config", {})
	var map: Dictionary = config.get("map", {})
	var id := str(map.get("theme", DEFAULT))
	return id if LOOKS.has(id) else DEFAULT


static func color(look: Dictionary, key: String) -> Color:
	return Color(str(look.get(key, LOOKS[DEFAULT][key])))


## Paint a terrain ShaderMaterial (terrain.gdshader) with a look.
static func paint_terrain(mat: ShaderMaterial, look: Dictionary) -> void:
	for pair: Array in [
		["grass_color", "grass"], ["grass_dark", "grass_dark"], ["soil_color", "soil"],
		["rock_color", "rock"], ["sand_color", "sand"], ["bedrock_color", "bedrock"],
	]:
		mat.set_shader_parameter(pair[0], color(look, pair[1]))
	# Storybook extras. A theme can name them; otherwise they come from its own colours.
	var lip := color(look, "grass_dark").darkened(0.35)
	var band := color(look, "soil").lightened(0.4)
	mat.set_shader_parameter("grass_lip", Color(str(look["grass_lip"])) if look.has("grass_lip") else lip)
	mat.set_shader_parameter("rock_band", Color(str(look["rock_band"])) if look.has("rock_band") else band)
	mat.set_shader_parameter("shadow_tint", Color(str(look.get("shadow", "6a5acd"))))


## Colour saturation for the whole picture. Bright themes get a Storybook boost; pastel and already
## loud themes less, so nothing turns neon.
static func saturation(look: Dictionary) -> float:
	return float(look.get("saturation", 1.25))


# ------------------------------------------------------------------ weather and time of day

const WEATHERS := ["clear", "rain", "storm", "fog"]
const TIMES := ["day", "dusk", "night"]

## Dusk and night skies. "day" is each theme's own light (some themes are already golden hour).
const TIME_LOOKS := {
	"dusk": {
		"sky_top": "4a5cb0", "sky_horizon": "ff9a5c", "sky_bottom": "c0687a",
		"sun": "ffb27a", "sun_energy": 1.15, "sun_pitch": -13.0, "fog": "f0a88a",
		"cloud": "ffc8a8", "ambient": 0.85, "sea_horizon": "ffa878",
	},
	"night": {
		"sky_top": "0a1430", "sky_horizon": "2c3a6e", "sky_bottom": "141b38",
		"sun": "b4c6ff", "sun_energy": 0.75, "sun_pitch": -42.0, "fog": "1c2648",
		"cloud": "6a76a0", "ambient": 0.6, "sea_horizon": "26386a", "cloud_glow": 0.12,
	},
}
## How bright each time is overall: weather greys are scaled by it so a rainy night stays dark.
const TIME_BRIGHTNESS := {"day": 1.0, "dusk": 0.78, "night": 0.3}


## The sky (weather, time) from a view match.start, or clear day when the server sent none.
static func sky_of(msg: Dictionary) -> Dictionary:
	var config: Dictionary = msg.get("config", {})
	var sky: Dictionary = config.get("sky", {})
	var weather := str(sky.get("weather", "clear"))
	var time := str(sky.get("time", "day"))
	return {
		"weather": weather if weather in WEATHERS else "clear",
		"time": time if time in TIMES else "day",
	}


## A theme's look under some weather at some time of day. Pure: the same inputs give the same
## look. Adds keys the environment reads: ambient, fog_near, fog_far, fog_density, fog_sky,
## night, wetness, window_glow, beam, rain, lightning, cloud_glow, cloud_count.
static func with_sky(look: Dictionary, weather: String, time: String) -> Dictionary:
	var out := look.duplicate()
	out["weather"] = weather
	out["time"] = time
	if TIME_LOOKS.has(time):
		var t: Dictionary = TIME_LOOKS[time]
		for k: String in t:
			out[k] = t[k]
		# The sea and ground keep their colours; only the light changes. The sea fades darker.
		if time == "night":
			out["sea_shallow"] = _hex(color(look, "sea_shallow").darkened(0.45))
			out["sea_deep"] = _hex(color(look, "sea_deep").darkened(0.55))
	out["night"] = time == "night"
	out["window_glow"] = {"day": 0.0, "dusk": 0.45, "night": 1.0}.get(time, 0.0)
	out["beam"] = {"day": 1.0, "dusk": 1.8, "night": 3.2}.get(time, 1.0)
	var lum: float = TIME_BRIGHTNESS.get(time, 1.0)
	var grey := {"rain": Color("98a4b8"), "storm": Color("5c6680"), "fog": Color("c8ced6")}
	var amount := {"rain": 0.6, "storm": 0.8, "fog": 0.55}
	if grey.has(weather):
		var g: Color = grey[weather] * lum
		g.a = 1.0
		var k: float = amount[weather]
		for key in ["sky_top", "sky_horizon", "sky_bottom", "cloud", "sea_horizon"]:
			out[key] = _hex(color(out, key).lerp(g, k))
		out["fog"] = _hex(color(out, "fog").lerp(g.lightened(0.1), 0.85))
		out["sun"] = _hex(color(out, "sun").lerp(Color("dde3ee"), k * 0.6))
		var dim := {"rain": 0.55, "storm": 0.38, "fog": 0.7}
		out["sun_energy"] = float(out.get("sun_energy", 1.5)) * float(dim[weather])
		out["saturation"] = float(out.get("saturation", 1.25)) * (0.82 if weather != "fog" else 0.88)
		out["cloud_count"] = {"rain": 28, "storm": 40, "fog": 10}[weather]
		# Rain clouds stay soft grey, never black blobs, even at night.
		var cloud := color(out, "cloud")
		if cloud.get_luminance() < 0.32:
			out["cloud"] = _hex(cloud.lerp(Color("8a94b0"), 0.6))
		out["cloud_glow"] = 0.1
	out["wetness"] = {"rain": 0.7, "storm": 1.0}.get(weather, 0.0)
	out["rain"] = {"rain": 1.0, "storm": 2.0}.get(weather, 0.0)
	out["lightning"] = weather == "storm"
	if weather == "fog":
		# A light haze over everything; the real fog is the drifting banks (Weather), so the
		# island stays playable between them.
		out["fog_near"] = 90.0
		out["fog_far"] = 650.0
		out["fog_density"] = 0.45
		out["fog_sky"] = 0.45
		out["fog_banks"] = 1.0
	elif weather in ["rain", "storm"]:
		out["fog_near"] = 120.0
		out["fog_far"] = 900.0
		out["fog_density"] = 0.7
		out["fog_sky"] = 0.3
	if not out.has("ambient"):
		out["ambient"] = 1.0
	if weather in ["rain", "storm"]:
		out["ambient"] = float(out["ambient"]) * (0.85 if weather == "rain" else 0.72)
	return out


static func _hex(c: Color) -> String:
	return c.to_html(false)
