class_name TeamStyle
extends RefCounted
## Eight team colours and hat styles (same as client/src/game3d/teamColors.ts). Index is the sim team index.

const NAMES: Array[String] = [
	"Tomato", "Sky", "Mustard", "Mint", "Grape", "Tangerine", "Bubblegum", "Slate"
]
const COLORS: Array[Color] = [
	Color("e85d4a"),
	Color("4aa3df"),
	Color("f2b544"),
	Color("5cc49b"),
	Color("8e5bc7"),
	Color("f08a3c"),
	Color("f08ac0"),
	Color("5b6b7a"),
]
const HATS: Array[String] = [
	"miner", "chef", "cone", "pirate", "propeller", "crown", "pot", "party"
]


static func color_of(team: int) -> Color:
	return COLORS[posmod(team, COLORS.size())]


static func name_of(team: int) -> String:
	return NAMES[posmod(team, NAMES.size())]


static func hat_of(team: int) -> String:
	return HATS[posmod(team, HATS.size())]


## A default look for a team index: {index, name, color, hat}.
static func default_look(team: int) -> Dictionary:
	return {"index": team, "name": name_of(team), "color": color_of(team), "hat": hat_of(team)}
