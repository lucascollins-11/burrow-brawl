class_name CritterNames
extends RefCounted
## Our own list of Squirmling names. A critter's name comes from its id, so every client shows the
## same name and no two critters in one match share one (the list is longer than a full match).

const NAMES: Array[String] = [
	"Wiggles", "Noodle", "Pip", "Bramble", "Mochi", "Fidget", "Pudding", "Snickers",
	"Tumble", "Biscuit", "Zigzag", "Marlow", "Dottie", "Wobble", "Sprout", "Crumpet",
	"Twirl", "Pickle", "Gizmo", "Muffin", "Squiggle", "Waffles", "Juniper", "Barnaby",
	"Pretzel", "Bumble", "Clover", "Doodle", "Fennel", "Gumdrop", "Hazel", "Inky",
	"Jellybean", "Kernel", "Lollop", "Maple", "Nugget", "Olive", "Pebble", "Quill",
	"Ripple", "Sausage", "Toffee", "Umber", "Velvet", "Whisk", "Yarn", "Zesty",
]


## The name for a critter id (ids from the sim start at 0 or 1; either way they spread evenly).
static func name_of(id: int) -> String:
	return NAMES[posmod(id, NAMES.size())]
