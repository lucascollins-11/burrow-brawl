extends TestCase

const AudioScript := preload("res://audio/audio.gd")


func test_render_is_deterministic_and_in_range() -> void:
	var p := {"wave": "noise", "freq": 900, "attack": 0.002, "sustain": 0.01, "decay": 0.05, "volume": 0.8}
	var a := AudioSynth.render(p, 4)
	var b := AudioSynth.render(p, 4)
	check(a.size() > 0, "has samples")
	check_eq(a, b, "same seed, same samples")
	var peak := 0.0
	for s in a:
		peak = maxf(peak, absf(s))
	check(peak > 0.05 and peak <= 1.0, "audible and not clipping")


func test_every_recipe_makes_a_short_audible_sound() -> void:
	for sfx_name in SfxRecipes.NAMES:
		var s := SfxRecipes.make(sfx_name)
		check(s.size() > 100, "%s has samples" % sfx_name)
		check(s.size() < AudioSynth.SAMPLE_RATE * 3, "%s is shorter than 3 seconds" % sfx_name)
		var peak := 0.0
		for v in s:
			peak = maxf(peak, absf(v))
		check(peak > 0.05, "%s is not silent" % sfx_name)
		check(peak <= 1.0, "%s stays in range" % sfx_name)


func test_bigger_explosions_last_longer() -> void:
	var small := SfxRecipes.make("explosion", "small").size()
	var large := SfxRecipes.make("explosion", "large").size()
	check(large > small, "large is longer than small")
	check_eq(SfxRecipes.size_for_radius(3.0), "small", "radius 3")
	check_eq(SfxRecipes.size_for_radius(7.0), "medium", "radius 7")
	check_eq(SfxRecipes.size_for_radius(12.0), "large", "radius 12")


func test_wav_file_has_a_valid_header_and_matching_length() -> void:
	var s := SfxRecipes.make("tick")
	var wav := AudioSynth.wav_file_bytes(s)
	check_eq(wav.size(), 44 + s.size() * 2, "header plus 16-bit samples")
	check_eq(wav.slice(0, 4).get_string_from_ascii(), "RIFF", "RIFF tag")
	check_eq(wav.slice(8, 12).get_string_from_ascii(), "WAVE", "WAVE tag")
	check_eq(wav.decode_u32(40), s.size() * 2, "data chunk size")


func test_stream_is_16_bit_mono_and_loops_when_asked() -> void:
	var s := AudioSynth.to_stream(SfxRecipes.make("jump"))
	check_eq(s.format, AudioStreamWAV.FORMAT_16_BITS, "16 bit")
	check(not s.stereo, "mono")
	check_eq(s.loop_mode, AudioStreamWAV.LOOP_DISABLED, "effects do not loop")
	var m := AudioSynth.to_stream(PackedFloat32Array([0.0, 0.5, -0.5, 0.0]), 8000, true)
	check_eq(m.loop_mode, AudioStreamWAV.LOOP_FORWARD, "music loops")
	check_eq(m.loop_end, 4, "loop covers the whole clip")


func test_event_plan_maps_each_sim_event() -> void:
	check_eq(AudioScript.plan_event({"type": "fired"})[0]["name"], "fire", "fired")
	var boom: Array = AudioScript.plan_event({"type": "explosion", "edit": {"op": "sphere", "r": 11}})
	check_eq(boom[0]["name"], "explosion", "explosion")
	check_eq(boom[0]["variant"], "large", "sized by radius")
	check_eq(AudioScript.plan_event({"type": "bounced"})[0]["name"], "bounce", "bounced")
	check_eq(AudioScript.plan_event({"type": "jumped", "backflip": false})[0]["name"], "jump", "jumped")
	check_eq(AudioScript.plan_event({"type": "landed", "fallDistance": 0.5}).size(), 0, "a tiny drop is silent")
	check_eq(AudioScript.plan_event({"type": "landed", "fallDistance": 8.0})[0]["name"], "land", "a real landing")
	check_eq(AudioScript.plan_event({"type": "damage", "amount": 20, "cause": "explosion"})[0]["name"], "hurt", "damage")
	check_eq(AudioScript.plan_event({"type": "damage", "amount": 20, "cause": "water"}).size(), 0, "drowning has its own sounds")
	var drown: Array = AudioScript.plan_event({"type": "died", "cause": "water"})
	check_eq(drown[0]["name"], "splash", "drowning splashes first")
	check_eq(drown[1]["name"], "knockout", "then knocks out")
	check_eq(AudioScript.plan_event({"type": "died", "cause": "explosion"})[0]["name"], "knockout", "knockout")
	check_eq(AudioScript.plan_event({"type": "nonsense"}).size(), 0, "unknown events are ignored")


func test_volume_to_decibels() -> void:
	check_eq(AudioScript.to_db(0.0), -80.0, "zero is silent")
	check(absf(AudioScript.to_db(1.0)) < 0.001, "full volume is 0 dB")
	check(AudioScript.to_db(0.5) < AudioScript.to_db(1.0), "quieter is lower")


func test_music_loops_have_the_planned_length() -> void:
	for track in MusicSynth.TRACKS:
		var s := MusicSynth.render(track)
		var want := int(MusicSynth.step_seconds(track) * float(MusicSynth.RATE)) * 32
		check_eq(s.size(), want, "%s loop length" % track)
		var peak := 0.0
		for v in s:
			peak = maxf(peak, absf(v))
		check(peak > 0.1 and peak <= 1.0, "%s is audible and in range" % track)
		check(absf(s[s.size() - 1]) < 0.01, "%s ends near silence so the loop does not click" % track)
	check(MusicSynth.loop_seconds("menu") > MusicSynth.loop_seconds("match"), "the match tune is faster")
