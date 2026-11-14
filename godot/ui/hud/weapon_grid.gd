class_name WeaponGrid
extends PanelContainer
## Weapon picker: a grid of tiles that scales to the whole 40-item arsenal. Each tile has a coloured
## icon (category colour and the item's initials, drawn in code), the name and the ammo left.
## Hover or focus a tile to read the description underneath. Only items in the ammo table get a
## tile on screen, so the grid shows what this match offers and grows as weapons are added; an item
## that has run out (0) stays, greyed. Emits `picked(id)`.

signal picked(id: String)

const COLUMNS := 8
const TILE := Vector2(112, 98)
## Room kept free around the grid: the bottom bar below it, the banner and team bars above.
const MARGIN_BELOW := 84.0
const MARGIN_ABOVE := 70.0

var _ammo: Dictionary = {}  # id -> count, -1 is unlimited
var _current := ""
var _tiles: Dictionary = {}  # id -> Button
var _desc: Label
var _grid: GridContainer
var _scroll: ScrollContainer


func _ready() -> void:
	theme = MenuStyle.theme()
	visible = false
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	add_child(col)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(_scroll)
	var grid := GridContainer.new()
	_grid = grid
	grid.columns = COLUMNS
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	_scroll.add_child(grid)
	for it in WeaponCatalog.ordered():
		var b := _make_tile(it)
		grid.add_child(b)
		_tiles[it["id"]] = b
	_desc = Label.new()
	_desc.custom_minimum_size = Vector2(0, 44)
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_desc.add_theme_font_size_override("font_size", 16)
	col.add_child(_desc)
	_refresh()
	var vp := get_viewport()
	if vp != null:
		vp.size_changed.connect(_fit)


func _make_tile(it: Dictionary) -> Button:
	var b := Button.new()
	b.custom_minimum_size = TILE
	b.focus_mode = Control.FOCUS_ALL
	b.clip_text = true
	b.tooltip_text = "%s: %s" % [it["name"], it["desc"]]
	b.pressed.connect(func() -> void: _on_tile(str(it["id"])))
	b.mouse_entered.connect(func() -> void: _describe(it))
	b.focus_entered.connect(func() -> void: _describe(it))
	var icon := ColorRect.new()
	icon.color = WeaponCatalog.category_color(it["cat"])
	icon.custom_minimum_size = Vector2(44, 34)
	icon.position = Vector2(30, 6)
	icon.size = Vector2(44, 34)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(icon)
	var initials := Label.new()
	initials.text = initials_of(str(it["name"]))
	initials.set_anchors_preset(Control.PRESET_FULL_RECT)
	initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	initials.label_settings = MenuStyle.heading(20, Color.WHITE, 5)
	initials.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icon.add_child(initials)
	var name_label := Label.new()
	name_label.name = "Name"
	name_label.text = two_lines(str(it["name"]))
	# Long names ("Pinecone Popper", "Mousetrap Snapper") wrap onto a second line.
	name_label.position = Vector2(2, 39)
	name_label.size = Vector2(TILE.x - 4, 30)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	# Two short lines break at the space nearest the middle (see two_lines), so nothing runs off the tile.
	name_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	name_label.custom_minimum_size = Vector2(TILE.x - 4, 30)
	name_label.add_theme_font_size_override("font_size", 10)
	name_label.add_theme_constant_override("line_spacing", -2)
	name_label.clip_text = true
	name_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(name_label)
	var ammo := Label.new()
	ammo.name = "Ammo"
	ammo.position = Vector2(2, 77)
	ammo.size = Vector2(TILE.x - 4, 18)
	ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ammo.add_theme_font_size_override("font_size", 13)
	ammo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(ammo)
	return b


## A long name split in two at the space nearest its middle ("Paper Plane\nSeeker"); short names and
## names without a space are left alone.
static func two_lines(item_name: String) -> String:
	if item_name.length() <= 11 or not item_name.contains(" "):
		return item_name
	var best := -1
	var mid := item_name.length() / 2
	for i in item_name.length():
		if item_name[i] == " " and (best < 0 or absi(i - mid) < absi(best - mid)):
			best = i
	return item_name.substr(0, best) + "\n" + item_name.substr(best + 1)


## Up to two letters: the first letters of the first two words ("Acorn Mortar" is "AM").
static func initials_of(item_name: String) -> String:
	var out := ""
	for word in item_name.split(" ", false):
		if out.length() < 2:
			out += word.substr(0, 1).to_upper()
	return out


## Make sure a weapon the server offers has a tile, even when the built-in list does not know it.
## `it` is {id, name, description} from the server's catalogue.
func ensure_item(it: Dictionary) -> void:
	var id := str(it.get("id", ""))
	if id == "" or _tiles.has(id) or _grid == null:
		return
	var tile := _make_tile(
		{"id": id, "name": str(it.get("name", id)), "cat": "artillery", "desc": str(it.get("description", ""))}
	)
	_grid.add_child(tile)
	_tiles[id] = tile


## ammo: item id -> count (-1 unlimited). Items not in the table are unavailable.
func set_ammo(ammo: Dictionary) -> void:
	_ammo = ammo
	_refresh()


func set_current(id: String) -> void:
	_current = id
	_refresh()


func is_available(id: String) -> bool:
	return int(_ammo.get(id, 0)) != 0


## Tallest the panel may be: the screen minus the bar below and the banner above, minus the
## description line and the panel's own padding. A taller grid scrolls instead of leaving the screen.
static func max_grid_height(screen_h: float) -> float:
	return maxf(120.0, screen_h - MARGIN_BELOW - MARGIN_ABOVE - 44.0 - 50.0)


func _fit() -> void:
	if _scroll == null or _grid == null or not is_inside_tree():
		return
	var want := _grid.get_combined_minimum_size().y
	_scroll.custom_minimum_size = Vector2(_grid.get_combined_minimum_size().x + 4.0, minf(want, max_grid_height(get_viewport_rect().size.y)))


func open() -> void:
	visible = true
	_fit()
	var first: Control = _tiles.get(_current if _current != "" else "acorn-mortar")
	if first != null and first.is_inside_tree():
		first.grab_focus()


func close() -> void:
	visible = false


func toggle() -> void:
	if visible:
		close()
	else:
		open()


func _on_tile(id: String) -> void:
	if not is_available(id):
		return
	picked.emit(id)
	close()


func _describe(it: Dictionary) -> void:
	if _desc == null:
		return
	var n := int(_ammo.get(it["id"], 0))
	var state := "" if n != 0 else "  (not available yet)"
	_desc.text = "%s - %s%s" % [it["name"], it["desc"], state]


func _refresh() -> void:
	for id in _tiles:
		var b: Button = _tiles[id]
		var n := int(_ammo.get(id, 0))
		b.disabled = n == 0
		b.visible = _ammo.has(id)
		b.modulate = Color.WHITE if n != 0 else Color(1, 1, 1, 0.45)
		# Toggle mode first, or the pressed look of the current weapon would not stick.
		b.toggle_mode = true
		b.set_pressed_no_signal(id == _current)
		var ammo := b.get_node_or_null("Ammo") as Label
		if ammo != null:
			ammo.text = WeaponCatalog.ammo_label(n) if n != 0 or _ammo.has(id) else ""
	if _grid != null:
		_grid.columns = columns_for(_ammo.size())
		# Shrink back towards the anchored corner after tiles are hidden; the panel then grows to
		# its new minimum size in its grow directions.
		offset_left = offset_right
		offset_top = offset_bottom
		_fit()


## Columns for a grid of `count` tiles: a compact block for a few, the full width for many.
static func columns_for(count: int) -> int:
	return clampi(ceili(sqrt(float(maxi(count, 1)) * 1.6)), 3, COLUMNS)
