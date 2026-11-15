class_name PromptLabel
extends RichTextLabel
## A label for hints and tutorial lines that draws pad glyph tokens (see Prompts) as images, so a
## prompt shows the buttons of the pad in use. Plain text and key names pass through unchanged.

var glyph_size := 22
var centered := false
var _shown := "\u0000"


func _init() -> void:
	bbcode_enabled = false
	fit_content = true
	scroll_active = false
	autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_font_px(px: int, color: Color) -> void:
	add_theme_font_size_override("normal_font_size", px)
	add_theme_color_override("default_color", color)
	glyph_size = int(px * 1.6)


## Show `text`; rebuilt only when it changes, so it is cheap to call every frame.
func set_prompt(text: String) -> void:
	if text == _shown:
		return
	_shown = text
	clear()
	if centered:
		push_paragraph(HORIZONTAL_ALIGNMENT_CENTER)
	for seg: Dictionary in Prompts.parse(text):
		if seg.has("text"):
			add_text(str(seg["text"]))
		else:
			add_image(PadGlyphs.texture(str(seg["family"]), int(seg["code"])), glyph_size, glyph_size, Color.WHITE, INLINE_ALIGNMENT_CENTER)
	if centered:
		pop()


## The text as it reads without glyphs, for tests and screen readers.
func shown_plain() -> String:
	return Prompts.plain(_shown)
