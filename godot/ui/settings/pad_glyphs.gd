class_name PadGlyphs
extends RefCounted
## Button glyphs for the three pad families, drawn here as small SVGs (no outside art, nothing to
## credit): coloured A B X Y for Xbox, cross, circle, square and triangle for PlayStation, plain
## B A Y X for Switch, plus shoulders, triggers, the D-pad, stick clicks and the menu buttons.
## `texture()` rasterises a glyph once and keeps it.

const SIZE := 64

## Letters and digits as stroked paths in a 12 x 16 box centred on (0, 0).
const LETTERS := {
	"A": "M-6 8 L0 -8 L6 8 M-3.2 2.5 L3.2 2.5",
	"B": "M-5 -8 V8 H1 Q6 8 6 4 Q6 0 1 0 H-5 M-5 -8 H0 Q5 -8 5 -4 Q5 0 0 0",
	"X": "M-6 -8 L6 8 M6 -8 L-6 8",
	"Y": "M-6 -8 L0 0 L6 -8 M0 0 V8",
	"L": "M-4 -8 V8 H5",
	"R": "M-5 8 V-8 H1 Q6 -8 6 -4 Q6 0 1 0 H-5 M1 0 L6 8",
	"Z": "M-5 -8 H5 L-5 8 H5",
	"1": "M-3 -4 L1 -8 V8",
	"2": "M-5 -5 Q-5 -8 0 -8 Q5 -8 5 -4 Q5 -1 -5 8 H5",
}

const INK := "#2a1d12"
const XBOX_COLORS := {
	JOY_BUTTON_A: "#4caf3a",
	JOY_BUTTON_B: "#e0452f",
	JOY_BUTTON_X: "#3f7fe0",
	JOY_BUTTON_Y: "#f2c230",
}
const PS_SYMBOLS := {
	JOY_BUTTON_A: ["#7aa7ff", "M-9 -9 L9 9 M9 -9 L-9 9"],
	JOY_BUTTON_B: ["#ff6b6b", "CIRCLE"],
	JOY_BUTTON_X: ["#ff8fd0", "M-9 -9 H9 V9 H-9 Z"],
	JOY_BUTTON_Y: ["#4ee08f", "M0 -11 L10 7 H-10 Z"],
}

static var _cache: Dictionary = {}


## The glyph for a pad code in a family, as a 64 x 64 texture.
static func texture(family: String, code: int) -> Texture2D:
	var key := "%s:%d" % [family, code]
	if _cache.has(key):
		return _cache[key]
	var img := Image.new()
	var err := img.load_svg_from_string(svg(family, code), 1.0)
	if err != OK:
		img = Image.create(SIZE, SIZE, false, Image.FORMAT_RGBA8)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


## The SVG text of a glyph.
static func svg(family: String, code: int) -> String:
	var body := ""
	match code:
		JOY_BUTTON_A, JOY_BUTTON_B, JOY_BUTTON_X, JOY_BUTTON_Y:
			body = _face(family, code)
		JOY_BUTTON_LEFT_SHOULDER, JOY_BUTTON_RIGHT_SHOULDER:
			body = _bumper(PadMap.button_name(family, code), false)
		PadMap.TRIGGER_LEFT, PadMap.TRIGGER_RIGHT:
			body = _bumper(PadMap.button_name(family, code), true)
		JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_LEFT, JOY_BUTTON_DPAD_RIGHT:
			body = _dpad(code)
		JOY_BUTTON_LEFT_STICK, PadMap.LEFT_STICK:
			body = _stick("L")
		JOY_BUTTON_RIGHT_STICK, PadMap.RIGHT_STICK:
			body = _stick("R")
		JOY_BUTTON_START:
			body = _menu_button(family, true)
		JOY_BUTTON_BACK:
			body = _menu_button(family, false)
		_:
			body = _disc("#8a7f72") + _letters("?", 32, 32, 1.2, "white")
	return '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 64 64">%s</svg>' % [SIZE, SIZE, body]


static func _disc(fill: String, stroke := INK) -> String:
	return '<circle cx="32" cy="32" r="28" fill="%s" stroke="%s" stroke-width="4"/>' % [fill, stroke]


static func _stroke(path: String, color: String, width := 5.0) -> String:
	return '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>' % [path, color, str(width)]


## Letters side by side, centred on (cx, cy).
static func _letters(text: String, cx: float, cy: float, scale: float, color: String) -> String:
	var out := ""
	var n := text.length()
	for i in range(n):
		var path: String = LETTERS.get(text[i], "")
		var x := cx + (float(i) - float(n - 1) / 2.0) * 14.0 * scale
		out += '<g transform="translate(%s %s) scale(%s)">%s</g>' % [str(x), str(cy), str(scale), _stroke(path, color, 4.5 / scale)]
	return out


static func _face(family: String, code: int) -> String:
	var label := PadMap.button_name(family, code)
	if family == PadMap.XBOX:
		var letter_color := INK if code == JOY_BUTTON_Y else "white"
		return _disc(XBOX_COLORS[code]) + _letters(label, 32, 32, 1.35, letter_color)
	if family == PadMap.PLAYSTATION:
		var sym: Array = PS_SYMBOLS[code]
		var shape: String
		if sym[1] == "CIRCLE":
			shape = '<circle cx="32" cy="32" r="11" fill="none" stroke="%s" stroke-width="5"/>' % sym[0]
		else:
			shape = '<g transform="translate(32 32) scale(1.1)">%s</g>' % _stroke(sym[1], sym[0], 4.5)
		return _disc("#2d3140", "#12141c") + shape
	return _disc("#e6e1d8") + _letters(label, 32, 32, 1.35, INK)


static func _bumper(label: String, trigger: bool) -> String:
	var fill := "#d6cfc3" if not trigger else "#b8b0a2"
	var shape := '<rect x="3" y="14" width="58" height="36" rx="%d" fill="%s" stroke="%s" stroke-width="4"/>' % [18 if trigger else 10, fill, INK]
	var scale := 1.0 if label.length() == 1 else 0.85
	return shape + _letters(label, 32, 32, scale, INK)


static func _dpad(code: int) -> String:
	var arm := '<path d="M23 6 H41 V23 H58 V41 H41 V58 H23 V41 H6 V23 H23 Z" fill="#d6cfc3" stroke="%s" stroke-width="4" stroke-linejoin="round"/>' % INK
	var hot := ""
	match code:
		JOY_BUTTON_DPAD_UP:
			hot = '<rect x="26" y="9" width="12" height="15" rx="3" fill="#ff8a2a"/>'
		JOY_BUTTON_DPAD_DOWN:
			hot = '<rect x="26" y="40" width="12" height="15" rx="3" fill="#ff8a2a"/>'
		JOY_BUTTON_DPAD_LEFT:
			hot = '<rect x="9" y="26" width="15" height="12" rx="3" fill="#ff8a2a"/>'
		JOY_BUTTON_DPAD_RIGHT:
			hot = '<rect x="40" y="26" width="15" height="12" rx="3" fill="#ff8a2a"/>'
	return arm + hot


static func _stick(side: String) -> String:
	return _disc("#4a4540", "#12141c") + '<circle cx="32" cy="32" r="15" fill="#8a8178" stroke="#12141c" stroke-width="3"/>' + _letters(side, 32, 32, 0.9, "white")


static func _menu_button(family: String, is_start: bool) -> String:
	if family == PadMap.SWITCH:
		var mark := "M20 32 H44 M32 20 V44" if is_start else "M20 32 H44"
		return _disc("#e6e1d8") + _stroke(mark, INK, 5.5)
	if family == PadMap.PLAYSTATION:
		var pill := '<rect x="6" y="16" width="52" height="32" rx="16" fill="#2d3140" stroke="#12141c" stroke-width="4"/>'
		if is_start:
			return pill + _stroke("M20 25 H44 M20 32 H44 M20 39 H44", "white", 4)
		return pill + _stroke("M24 40 V30 H40 V40 M32 38 V22 M27 27 L32 22 L37 27", "white", 3.5)
	var disc := _disc("#4a4540", "#12141c")
	if is_start:
		return disc + _stroke("M20 24 H44 M20 32 H44 M20 40 H44", "white", 4)
	return disc + _stroke("M19 24 H37 V38 H19 Z M27 30 H45 V44 H27", "white", 3.5)
