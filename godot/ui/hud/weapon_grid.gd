class_name WeaponGrid
extends PanelContainer
## Weapon picker: a grid of tiles that scales to the whole 40-item arsenal. Each tile has a coloured
## icon (category colour and the item's initials, drawn in code), the name and the ammo left.
## Hover or focus a tile to read the description underneath. Items with no ammo entry (or 0) are
## shown greyed and cannot be picked. Emits `picked(id)`.

signal picked(id: String)

const COLUMNS := 8
const TILE := Vector2(104, 92)

var _ammo: Dictionary = {}  # id -> count, -1 is unlimited
var _current := ""
var _tiles: Dictionary = {}  # id -> Button
var _desc: Label


func _ready() -> void:
	theme = MenuStyle.theme()
	visible = false
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	add_child(col)
	var grid := GridContainer.new()
	grid.columns = COLUMNS
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	col.add_child(grid)
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
	name_label.text = str(it["name"])
	name_label.position = Vector2(2, 44)
	name_label.size = Vector2(TILE.x - 4, 22)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 12)
	name_label.clip_text = true
	name_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(name_label)
	var ammo := Label.new()
	ammo.name = "Ammo"
	ammo.position = Vector2(2, 66)
	ammo.size = Vector2(TILE.x - 4, 18)
	ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ammo.add_theme_font_size_override("font_size", 13)
	ammo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(ammo)
	return b


## Up to two letters: the first letters of the first two words ("Acorn Mortar" is "AM").
static func initials_of(item_name: String) -> String:
	var out := ""
	for word in item_name.split(" ", false):
		if out.length() < 2:
			out += word.substr(0, 1).to_upper()
	return out


## ammo: item id -> count (-1 unlimited). Items not in the table are unavailable.
func set_ammo(ammo: Dictionary) -> void:
	_ammo = ammo
	_refresh()


func set_current(id: String) -> void:
	_current = id
	_refresh()


func is_available(id: String) -> bool:
	return int(_ammo.get(id, 0)) != 0


func open() -> void:
	visible = true
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
		b.modulate = Color.WHITE if n != 0 else Color(1, 1, 1, 0.45)
		b.set_pressed_no_signal(id == _current)
		b.toggle_mode = false
		var ammo := b.get_node_or_null("Ammo") as Label
		if ammo != null:
			ammo.text = WeaponCatalog.ammo_label(n) if n != 0 or _ammo.has(id) else ""
