class_name WeaponCatalog
extends RefCounted
## The 40 arsenal items (plan/arsenal.md) as UI data: id, name, category and a one-line description.
## Ids match shared/weapons/*.json (kebab-case of the name). Whether an item can be used right now
## is not decided here: the match gives the HUD an ammo table (see WeaponGrid.set_ammo).

const CATEGORIES: Array[Dictionary] = [
	{"id": "artillery", "name": "Artillery", "color": Color("ff8a3d")},
	{"id": "grenade", "name": "Grenades", "color": Color("5cc46a")},
	{"id": "airstrike", "name": "Air strikes", "color": Color("4aa3df")},
	{"id": "walker", "name": "Walkers", "color": Color("b07be0")},
	{"id": "gun", "name": "Guns", "color": Color("e85d4a")},
	{"id": "melee", "name": "Melee", "color": Color("d9a441")},
	{"id": "trap", "name": "Traps", "color": Color("8d6e63")},
	{"id": "mobility", "name": "Mobility", "color": Color("3fc1b0")},
	{"id": "utility", "name": "Utilities", "color": Color("9aa7b8")},
	{"id": "super", "name": "Super", "color": Color("ff5ca8")},
]

const ITEMS: Array[Dictionary] = [
	{"id": "acorn-mortar", "name": "Acorn Mortar", "cat": "artillery", "desc": "Charged shell on the classic arc. Wind pushes it."},
	{"id": "pinecone-popper", "name": "Pinecone Popper", "cat": "artillery", "desc": "Click mid-flight to burst it into 5 seeds."},
	{"id": "fizz-rocket", "name": "Fizz Rocket", "cat": "artillery", "desc": "Flies flat for a second, then gravity takes over."},
	{"id": "paper-plane-seeker", "name": "Paper Plane Seeker", "cat": "artillery", "desc": "Mark a target and it glides there."},
	{"id": "slingshot", "name": "Slingshot", "cat": "artillery", "desc": "Precise, no wind, small blast. Great for finishing."},
	{"id": "fizz-grenade", "name": "Fizz Grenade", "cat": "grenade", "desc": "Bouncy timed grenade, 1 to 5 second fuse."},
	{"id": "gumball-cluster", "name": "Gumball Cluster", "cat": "grenade", "desc": "Bursts into sticky gumballs that cling where they land."},
	{"id": "snow-globe", "name": "Snow Globe", "cat": "grenade", "desc": "No damage. Freezes critters in the radius for a turn."},
	{"id": "hot-sauce-flask", "name": "Hot Sauce Flask", "cat": "grenade", "desc": "Burning puddles hurt anyone who stands in them."},
	{"id": "beehive-strike", "name": "Beehive Strike", "cat": "airstrike", "desc": "Five bombs in a line across your click point."},
	{"id": "lantern-drift", "name": "Lantern Drift", "cat": "airstrike", "desc": "Paper lanterns float in on the wind and pop on contact."},
	{"id": "toy-block-drop", "name": "Toy Block Drop", "cat": "airstrike", "desc": "One giant block falls and stays as terrain."},
	{"id": "wind-up-robot", "name": "Wind-up Robot", "cat": "walker", "desc": "Marches forward, climbs steps, explodes on click or after 8 s."},
	{"id": "marble-roller", "name": "Marble Roller", "cat": "walker", "desc": "Rolls downhill along the terrain, gaining speed."},
	{"id": "rc-racer", "name": "RC Racer", "cat": "walker", "desc": "Drive it for 8 seconds, then it detonates."},
	{"id": "kite-bomber", "name": "Kite Bomber", "cat": "walker", "desc": "Steer a kite for 6 seconds. It drops one charge."},
	{"id": "pepper-shotgun", "name": "Pepper Shotgun", "cat": "gun", "desc": "Two instant blasts per turn."},
	{"id": "pea-gatling", "name": "Pea Gatling", "cat": "gun", "desc": "A 3 second stream of peas to sweep across targets."},
	{"id": "water-pistol", "name": "Water Pistol", "cat": "gun", "desc": "Low damage, pushes critters toward the edge."},
	{"id": "root-punch", "name": "Root Punch", "cat": "melee", "desc": "Uppercut with a big vertical launch."},
	{"id": "spatula-swat", "name": "Spatula Swat", "cat": "melee", "desc": "Wide swing that hits everyone in front."},
	{"id": "pillow-bash", "name": "Pillow Bash", "cat": "melee", "desc": "No damage, huge sideways knockback."},
	{"id": "jelly-mine", "name": "Jelly Mine", "cat": "trap", "desc": "Proximity mine. Arms after 2 seconds."},
	{"id": "mousetrap-snapper", "name": "Mousetrap Snapper", "cat": "trap", "desc": "Flings any critter that steps on it high into the air."},
	{"id": "glue-puddle", "name": "Glue Puddle", "cat": "trap", "desc": "Critters inside cannot walk or jump next turn."},
	{"id": "rope-claw", "name": "Rope Claw", "cat": "mobility", "desc": "Grapple, swing and let go."},
	{"id": "spring-boots", "name": "Spring Boots", "cat": "mobility", "desc": "One giant leap."},
	{"id": "umbrella-glide", "name": "Umbrella Glide", "cat": "mobility", "desc": "Open it mid-air to drift down safely."},
	{"id": "soda-jetpack", "name": "Soda Jetpack", "cat": "mobility", "desc": "Fuel-limited fizzy flight."},
	{"id": "teleport-burrow", "name": "Teleport Burrow", "cat": "mobility", "desc": "Go anywhere open. Ends your turn."},
	{"id": "drill-hat", "name": "Drill Hat", "cat": "mobility", "desc": "Tunnel in the facing direction for 3 seconds."},
	{"id": "build-block", "name": "Build Block", "cat": "utility", "desc": "Place a toy block as new terrain."},
	{"id": "feather-charm", "name": "Feather Charm", "cat": "utility", "desc": "Low gravity for you and your shots this turn."},
	{"id": "bubble-shield", "name": "Bubble Shield", "cat": "utility", "desc": "Absorbs the next hit on this critter."},
	{"id": "cookie-snack", "name": "Cookie Snack", "cat": "utility", "desc": "+25 HP to yourself or an adjacent teammate."},
	{"id": "skip-turn", "name": "White Hanky", "cat": "utility", "desc": "Pass the turn, or concede the match."},
	{"id": "boulder-of-doom", "name": "Boulder of Doom", "cat": "super", "desc": "Slow, huge, unstoppable rolling bomb. Crate only."},
	{"id": "marble-meteor-shower", "name": "Marble Meteor Shower", "cat": "super", "desc": "20 marbles rain over 4 seconds. Crate only."},
	{"id": "party-pinata", "name": "Party Pinata", "cat": "super", "desc": "Bursts into a ring of candy bombs. Crate only."},
	{"id": "tabletop-quake", "name": "Tabletop Quake", "cat": "super", "desc": "Shakes everyone toward the water. Crate only."},
]


static func category_color(cat: String) -> Color:
	for c in CATEGORIES:
		if c["id"] == cat:
			return c["color"]
	return Color.GRAY


static func category_name(cat: String) -> String:
	for c in CATEGORIES:
		if c["id"] == cat:
			return c["name"]
	return cat


static func find(id: String) -> Dictionary:
	for it in ITEMS:
		if it["id"] == id:
			return it
	return {}


## Items in menu order: by category, then arsenal order.
static func ordered() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for c in CATEGORIES:
		for it in ITEMS:
			if it["cat"] == c["id"]:
				out.append(it)
	return out


## Short label for an ammo count: infinity for -1, "x3" otherwise, "" when it is none or unknown.
static func ammo_label(count: int) -> String:
	if count < 0:
		return "inf"
	if count == 0:
		return "out"
	return "x%d" % count
