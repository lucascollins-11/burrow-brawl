class_name MusicSynth
extends RefCounted
## Two short original music loops, written as note tables and rendered with the same synth as the
## sound effects. "menu" is a calm major-pentatonic tune, "match" is a bouncier minor one. Notes are
## MIDI numbers, 0 is a rest, and each step is an eighth note.

const RATE := 12000
const TRACKS := ["menu", "match"]

# Eighth-note steps: 32 steps = 4 bars of 4/4.
const MENU_BPM := 92.0
const MENU_MELODY := [
	72, 0, 76, 0, 79, 76, 0, 74,
	69, 0, 72, 0, 76, 72, 0, 71,
	65, 0, 69, 0, 72, 69, 0, 67,
	67, 0, 71, 74, 79, 0, 76, 0,
]
const MENU_BASS := [48, 45, 41, 43]  # C, A, F, G: one per bar
const MENU_CHORDS := [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]

const MATCH_BPM := 128.0
const MATCH_MELODY := [
	69, 0, 72, 69, 0, 76, 74, 0,
	65, 0, 69, 65, 0, 72, 71, 0,
	72, 0, 76, 72, 0, 79, 76, 0,
	71, 0, 74, 71, 0, 79, 77, 74,
]
const MATCH_BASS := [45, 41, 48, 43]  # A, F, C, G
const MATCH_CHORDS := [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]


static func midi_to_hz(note: int) -> float:
	return 440.0 * pow(2.0, float(note - 69) / 12.0)


static func step_seconds(track: String) -> float:
	var bpm := MENU_BPM if track == "menu" else MATCH_BPM
	return 60.0 / bpm / 2.0


static func loop_seconds(track: String) -> float:
	return step_seconds(track) * 32.0


## Render a track as one seamless loop of mono samples.
static func render(track: String) -> PackedFloat32Array:
	var menu := track == "menu"
	var melody: Array = MENU_MELODY if menu else MATCH_MELODY
	var bass: Array = MENU_BASS if menu else MATCH_BASS
	var chords: Array = MENU_CHORDS if menu else MATCH_CHORDS
	var step := step_seconds(track)
	var step_samples := int(step * float(RATE))
	var out := PackedFloat32Array()
	out.resize(step_samples * 32)
	for i in range(32):
		var at := i * step_samples
		var note: int = melody[i]
		if note > 0:
			var lead := {
				"wave": "triangle" if menu else "square",
				"duty": 0.3,
				"freq": midi_to_hz(note),
				"attack": 0.01,
				"sustain": step * 0.5,
				"decay": step * 1.4,
				"volume": 0.22 if menu else 0.12,
				"lowpass": 1.0 if menu else 0.5,
			}
			AudioSynth.add_into(out, AudioSynth.render(lead, 1, RATE), at)
		# Bass: one long note a bar in the menu, a bounce on every beat in the match.
		var bar := i >> 3
		if menu:
			if i % 8 == 0:
				var b := {"wave": "sine", "freq": midi_to_hz(int(bass[bar])), "attack": 0.02, "sustain": step * 5.0, "decay": step * 2.5, "volume": 0.3}
				AudioSynth.add_into(out, AudioSynth.render(b, 1, RATE), at)
		elif i % 2 == 0:
			var root := int(bass[bar]) + (12 if ((i >> 1) % 2) == 1 else 0)
			var b2 := {"wave": "triangle", "freq": midi_to_hz(root), "attack": 0.005, "sustain": step * 0.4, "decay": step * 0.9, "volume": 0.3}
			AudioSynth.add_into(out, AudioSynth.render(b2, 1, RATE), at)
		# Soft chord pluck on the off beats.
		if i % 4 == 2:
			for n in chords[bar]:
				var c := {"wave": "sine", "freq": midi_to_hz(int(n)), "attack": 0.004, "sustain": 0.0, "decay": step * 1.6, "volume": 0.07}
				AudioSynth.add_into(out, AudioSynth.render(c, 1, RATE), at)
	# A tail that rang past the end would click at the loop point, so fade the last few ms.
	var fade := mini(out.size(), int(0.01 * float(RATE)))
	for k in range(fade):
		out[out.size() - 1 - k] *= float(k) / float(fade)
	for i in range(out.size()):
		out[i] = clampf(out[i], -1.0, 1.0)
	return out


static func stream(track: String) -> AudioStreamWAV:
	return AudioSynth.to_stream(render(track), RATE, true)
