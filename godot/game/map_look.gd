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
	},
	# Brass and copper under a violet dusk.
	"clockwork-mesa": {
		"grass": "c9a23a", "grass_dark": "9c7a2b", "soil": "b5673a", "rock": "6d5a52",
		"sand": "e3c58f", "bedrock": "33303f",
		"sea_shallow": "9ad6c9", "sea_deep": "24506b", "sea_horizon": "e8a6b8",
		"sky_top": "4a3f8c", "sky_horizon": "f09a7a", "sky_bottom": "7a4a6b",
		"sun": "ffc48a", "sun_energy": 1.45, "sun_pitch": -28.0, "fog": "e8a6a0",
		"cloud": "ffd9c9", "debris": "9c7a2b",
	},
	# A sunny vegetable patch: bright lawn, dark soil, terracotta pots, a green pond.
	"garden-patch": {
		"grass": "62c24a", "grass_dark": "2f8f3a", "soil": "7a4a2e", "rock": "b8663f",
		"sand": "e8d6a0", "bedrock": "3e3b34",
		"sea_shallow": "8fe0b0", "sea_deep": "1f7a6a", "sea_horizon": "d8f2c8",
		"sky_top": "5aa8e8", "sky_horizon": "ffe9b0", "sky_bottom": "a8d08a",
		"sun": "fff2c0", "sun_energy": 1.6, "sun_pitch": -42.0, "fog": "e6f2c8",
		"cloud": "ffffff", "debris": "7a4a2e",
	},
	# Soap bars and a sponge in a steamy bathtub: porcelain blues, pink foam, warm light.
	"bathtub-bay": {
		"grass": "f7b6d6", "grass_dark": "c9a3ea", "soil": "fbd9a4", "rock": "a6c4f2",
		"sand": "d9b04e", "bedrock": "5a5f8c",
		"sea_shallow": "7fd4f2", "sea_deep": "1c63b0", "sea_horizon": "d6efff",
		"sky_top": "7fc8f8", "sky_horizon": "fff1e0", "sky_bottom": "d6ecf5",
		"sun": "fff6e0", "sun_energy": 1.5, "sun_pitch": -50.0, "fog": "e6f7ff",
		"cloud": "ffffff", "debris": "f4e4f0",
	},
	# Icing on sponge cake in strawberry soda.
	"frosted-bakery": {
		"grass": "fff6f0", "grass_dark": "ffd6e3", "soil": "e8b56b", "rock": "b5763f",
		"sand": "fff0c9", "bedrock": "6b3f33",
		"sea_shallow": "ffc2d6", "sea_deep": "c2477a", "sea_horizon": "ffe3d6",
		"sky_top": "8fc2f2", "sky_horizon": "ffe0ea", "sky_bottom": "f2b5c7",
		"sun": "fff0e0", "sun_energy": 1.5, "sun_pitch": -45.0, "fog": "ffe6ee",
		"cloud": "ffffff", "debris": "e8b56b",
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
