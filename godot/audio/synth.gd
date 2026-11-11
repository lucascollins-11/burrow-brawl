class_name AudioSynth
extends RefCounted
## Original jsfxr-style synthesis (port of client/src/audio/synth.ts). Every sound is generated
## from a handful of numbers: no recorded or copied audio anywhere. Pure functions, so headless
## tests can check them without an audio device.

const SAMPLE_RATE := 22050


## Render one voice. Keys of `p` (all optional except wave and freq):
## wave: "square" | "saw" | "sine" | "noise" | "triangle", freq (Hz), slide (octaves per second),
## vibrato (0..1), vibrato_rate (Hz), attack / sustain / decay (seconds), volume, duty (0..1),
## lowpass (0..1, 1 = off).
static func render(p: Dictionary, seed_value: int = 1, rate: int = SAMPLE_RATE) -> PackedFloat32Array:
	var attack := float(p.get("attack", 0.002))
	var sustain := float(p.get("sustain", 0.0))
	var decay := float(p.get("decay", 0.1))
	var total := attack + sustain + decay
	var n := maxi(1, int(total * float(rate)))
	var out := PackedFloat32Array()
	out.resize(n)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var wave := str(p.get("wave", "sine"))
	var freq := float(p.get("freq", 440.0))
	var slide := float(p.get("slide", 0.0))
	var vibrato := float(p.get("vibrato", 0.0))
	var vibrato_rate := float(p.get("vibrato_rate", 8.0))
	var volume := float(p.get("volume", 0.5))
	var duty := float(p.get("duty", 0.5))
	var lowpass := float(p.get("lowpass", 1.0))
	var phase := 0.0
	var lp := 0.0
	var held := rng.randf() * 2.0 - 1.0
	for i in range(n):
		var t := float(i) / float(rate)
		var env: float
		if t < attack:
			env = t / maxf(attack, 0.000001)
		elif t < attack + sustain:
			env = 1.0
		else:
			env = 1.0 - (t - attack - sustain) / maxf(decay, 0.000001)
		env = maxf(0.0, env)
		var vib := 1.0
		if vibrato > 0.0:
			vib = 1.0 + vibrato * 0.1 * sin(TAU * vibrato_rate * t)
		var f := maxf(20.0, freq * pow(2.0, slide * t) * vib)
		phase += f / float(rate)
		var ph := fposmod(phase, 1.0)
		var s := 0.0
		match wave:
			"square":
				s = 1.0 if ph < duty else -1.0
			"saw":
				s = 2.0 * ph - 1.0
			"triangle":
				s = 4.0 * absf(ph - 0.5) - 1.0
			"noise":
				# Sample-and-hold noise: the pitch decides how crunchy it is.
				if ph < f / float(rate):
					held = rng.randf() * 2.0 - 1.0
				s = held
			_:
				s = sin(TAU * ph)
		if lowpass < 1.0:
			lp += (s - lp) * lowpass
			s = lp
		out[i] = s * env * volume
	return out


## Add several layers together (padded to the longest) and clamp to -1..1.
static func mix(layers: Array) -> PackedFloat32Array:
	var n := 0
	for l in layers:
		n = maxi(n, (l as PackedFloat32Array).size())
	var out := PackedFloat32Array()
	out.resize(n)
	for l in layers:
		var arr: PackedFloat32Array = l
		for i in range(arr.size()):
			out[i] += arr[i]
	for i in range(n):
		out[i] = clampf(out[i], -1.0, 1.0)
	return out


## Delay a sound by `seconds` of silence.
static func shift(s: PackedFloat32Array, seconds: float, rate: int = SAMPLE_RATE) -> PackedFloat32Array:
	var pad := int(seconds * float(rate))
	var out := PackedFloat32Array()
	out.resize(s.size() + pad)
	for i in range(s.size()):
		out[pad + i] = s[i]
	return out


## Add `src` into `dst` starting at `offset` samples (grows nothing; clips at the end of dst).
static func add_into(dst: PackedFloat32Array, src: PackedFloat32Array, offset: int) -> void:
	var n := mini(src.size(), dst.size() - offset)
	for i in range(maxi(0, n)):
		dst[offset + i] += src[i]


## 16-bit mono PCM bytes for an AudioStreamWAV.
static func pcm16(samples: PackedFloat32Array) -> PackedByteArray:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in range(samples.size()):
		data.encode_s16(i * 2, int(roundf(clampf(samples[i], -1.0, 1.0) * 32767.0)))
	return data


static func to_stream(samples: PackedFloat32Array, rate: int = SAMPLE_RATE, loop := false) -> AudioStreamWAV:
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.stereo = false
	s.data = pcm16(samples)
	if loop:
		s.loop_mode = AudioStreamWAV.LOOP_FORWARD
		s.loop_begin = 0
		s.loop_end = samples.size()
	return s


## A complete .wav file (RIFF header plus PCM), for tools that want files on disk.
static func wav_file_bytes(samples: PackedFloat32Array, rate: int = SAMPLE_RATE) -> PackedByteArray:
	var pcm := pcm16(samples)
	var out := PackedByteArray()
	out.resize(44)
	out.encode_u32(4, 36 + pcm.size())
	for i in range(4):
		out[i] = "RIFF".unicode_at(i)
		out[8 + i] = "WAVE".unicode_at(i)
		out[12 + i] = "fmt ".unicode_at(i)
		out[36 + i] = "data".unicode_at(i)
	out.encode_u32(16, 16)
	out.encode_u16(20, 1)
	out.encode_u16(22, 1)
	out.encode_u32(24, rate)
	out.encode_u32(28, rate * 2)
	out.encode_u16(32, 2)
	out.encode_u16(34, 16)
	out.encode_u32(40, pcm.size())
	out.append_array(pcm)
	return out
