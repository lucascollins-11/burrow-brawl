class_name SfxRecipes
extends RefCounted
## The game's sound effects as numbers (port of client/src/audio/effects.ts, extended with bounce,
## knockout, splash, turn start and timer tick). Each recipe returns mono samples in -1..1.

const NAMES := [
	"fire",
	"explosion",
	"bounce",
	"jump",
	"land",
	"hurt",
	"knockout",
	"splash",
	"turn_start",
	"tick",
	"ui_click",
	"ui_hover",
	"ui_confirm",
	"thunder",
]

## Explosions come in three sizes so a bigger blast sounds bigger.
const EXPLOSION_SIZES := ["small", "medium", "large"]


static func size_for_radius(radius: float) -> String:
	if radius < 5.0:
		return "small"
	if radius < 9.0:
		return "medium"
	return "large"


static func make(name: String, variant: String = "") -> PackedFloat32Array:
	match name:
		"fire":
			return _fire()
		"explosion":
			return _explosion(variant if variant != "" else "medium")
		"bounce":
			return _bounce()
		"jump":
			return _jump()
		"land":
			return _land()
		"hurt":
			return _hurt()
		"knockout":
			return _knockout()
		"splash":
			return _splash()
		"turn_start":
			return _turn_start()
		"tick":
			return _tick()
		"ui_click":
			return _ui_click()
		"ui_hover":
			return _ui_hover()
		"ui_confirm":
			return _ui_confirm()
		"thunder":
			return _thunder(variant != "far")
	return PackedFloat32Array()


static func _v(p: Dictionary, seed_value := 1) -> PackedFloat32Array:
	return AudioSynth.render(p, seed_value)


## Cartoon thwoomp: a falling sine and a short noise puff.
static func _fire() -> PackedFloat32Array:
	return AudioSynth.mix(
		[
			_v({"wave": "sine", "freq": 520, "slide": -2.2, "attack": 0.005, "sustain": 0.03, "decay": 0.2, "volume": 0.7}),
			_v({"wave": "noise", "freq": 3000, "slide": -1, "attack": 0.002, "sustain": 0.02, "decay": 0.09, "volume": 0.35, "lowpass": 0.5}, 7),
		]
	)


## Low rumble and crackle. A larger size is lower, longer and louder.
static func _explosion(size: String) -> PackedFloat32Array:
	var k := 1.0
	match size:
		"small":
			k = 0.65
		"large":
			k = 1.5
	return AudioSynth.mix(
		[
			_v({"wave": "noise", "freq": 900.0 / k, "slide": -1.6, "attack": 0.005, "sustain": 0.12 * k, "decay": 0.55 * k, "volume": 0.85, "lowpass": 0.25}, 3),
			_v({"wave": "sine", "freq": 110.0 / k, "slide": -1.4, "attack": 0.003, "sustain": 0.08 * k, "decay": 0.45 * k, "volume": 0.8}),
			_v({"wave": "noise", "freq": 4500, "slide": -2, "attack": 0.001, "sustain": 0.01, "decay": 0.12, "volume": 0.35, "lowpass": 0.7}, 11),
		]
	)


## A short rubbery "bonk".
static func _bounce() -> PackedFloat32Array:
	return _v({"wave": "triangle", "freq": 330, "slide": -1.2, "vibrato": 0.3, "vibrato_rate": 28, "attack": 0.002, "sustain": 0.01, "decay": 0.1, "volume": 0.5})


## Springy rising boing.
static func _jump() -> PackedFloat32Array:
	return _v({"wave": "triangle", "freq": 260, "slide": 1.6, "vibrato": 0.4, "vibrato_rate": 22, "attack": 0.005, "sustain": 0.05, "decay": 0.16, "volume": 0.6})


## Soft thud.
static func _land() -> PackedFloat32Array:
	return AudioSynth.mix(
		[
			_v({"wave": "sine", "freq": 150, "slide": -1.8, "attack": 0.002, "sustain": 0.01, "decay": 0.12, "volume": 0.8}),
			_v({"wave": "noise", "freq": 1200, "slide": -2, "attack": 0.001, "sustain": 0.005, "decay": 0.05, "volume": 0.3, "lowpass": 0.3}, 5),
		]
	)


## Squeaky "ow": a wobbly square dropping in pitch.
static func _hurt() -> PackedFloat32Array:
	return _v({"wave": "square", "duty": 0.35, "freq": 880, "slide": -1.3, "vibrato": 0.7, "vibrato_rate": 30, "attack": 0.003, "sustain": 0.06, "decay": 0.2, "volume": 0.45, "lowpass": 0.6})


## A long sad slide down with a little pop at the end.
static func _knockout() -> PackedFloat32Array:
	var slide := _v({"wave": "triangle", "freq": 700, "slide": -1.4, "vibrato": 0.5, "vibrato_rate": 14, "attack": 0.004, "sustain": 0.18, "decay": 0.45, "volume": 0.55})
	var pop := AudioSynth.shift(_v({"wave": "sine", "freq": 420, "slide": 1.5, "attack": 0.001, "sustain": 0.01, "decay": 0.07, "volume": 0.5}), 0.62)
	return AudioSynth.mix([slide, pop])


## A big wet plop into the soda: low sine drop and fizzy noise.
static func _splash() -> PackedFloat32Array:
	return AudioSynth.mix(
		[
			_v({"wave": "sine", "freq": 300, "slide": -2.0, "attack": 0.003, "sustain": 0.03, "decay": 0.25, "volume": 0.6}),
			_v({"wave": "noise", "freq": 2500, "slide": -0.8, "attack": 0.01, "sustain": 0.1, "decay": 0.4, "volume": 0.4, "lowpass": 0.45}, 13),
		]
	)


## Two bright notes, going up: "your turn".
static func _turn_start() -> PackedFloat32Array:
	var a := _v({"wave": "square", "duty": 0.4, "freq": 523.25, "attack": 0.002, "sustain": 0.07, "decay": 0.06, "volume": 0.3, "lowpass": 0.6})
	var b := AudioSynth.shift(_v({"wave": "square", "duty": 0.4, "freq": 783.99, "attack": 0.002, "sustain": 0.12, "decay": 0.14, "volume": 0.3, "lowpass": 0.6}), 0.09)
	return AudioSynth.mix([a, b])


## A dry wooden tick for the last seconds of the timer.
static func _tick() -> PackedFloat32Array:
	return _v({"wave": "square", "duty": 0.25, "freq": 1500, "slide": -0.6, "attack": 0.001, "sustain": 0.004, "decay": 0.03, "volume": 0.3, "lowpass": 0.55})


static func _ui_click() -> PackedFloat32Array:
	return _v({"wave": "square", "duty": 0.5, "freq": 700, "slide": 1.0, "attack": 0.001, "sustain": 0.012, "decay": 0.05, "volume": 0.35, "lowpass": 0.7})


static func _ui_hover() -> PackedFloat32Array:
	return _v({"wave": "sine", "freq": 900, "slide": 0.3, "attack": 0.001, "sustain": 0.005, "decay": 0.035, "volume": 0.2})


## Two quick rising blips.
static func _ui_confirm() -> PackedFloat32Array:
	var a := _v({"wave": "square", "duty": 0.4, "freq": 520, "attack": 0.001, "sustain": 0.05, "decay": 0.04, "volume": 0.3, "lowpass": 0.7})
	var b := AudioSynth.shift(_v({"wave": "square", "duty": 0.4, "freq": 780, "attack": 0.001, "sustain": 0.07, "decay": 0.08, "volume": 0.3, "lowpass": 0.7}), 0.07)
	return AudioSynth.mix([a, b])


## Thunder: a crack (near strikes only) and a long low rolling rumble.
static func _thunder(near: bool) -> PackedFloat32Array:
	var layers := [
		_v({"wave": "noise", "freq": 220.0, "slide": -0.25, "attack": 0.08, "sustain": 0.6, "decay": 2.2, "volume": 0.9, "lowpass": 0.06}, 21),
		_v({"wave": "noise", "freq": 140.0, "slide": -0.15, "attack": 0.3, "sustain": 0.4, "decay": 1.8, "volume": 0.7, "lowpass": 0.04}, 22),
		_v({"wave": "sine", "freq": 48.0, "slide": -0.3, "attack": 0.05, "sustain": 0.5, "decay": 1.6, "volume": 0.5}),
	]
	if near:
		layers.append(_v({"wave": "noise", "freq": 5000, "slide": -3.0, "attack": 0.001, "sustain": 0.03, "decay": 0.25, "volume": 0.6, "lowpass": 0.8}, 23))
	return AudioSynth.mix(layers)
