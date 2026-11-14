class_name HudModel
extends RefCounted
## HUD numbers and text from a ViewModel snapshot (port of client/src/game3d/hudModel.ts).
## No nodes in here, so it is easy to test.


## One compact bar per team: alive count, summed health, fraction, out, active.
static func summarize_teams(v: Dictionary) -> Array:
	var out: Array = []
	for t in v["teams"]:
		var idx: int = t["index"]
		var alive := 0
		var total := 0
		var hp := 0
		var max_hp := 0
		for c in v["critters"]:
			if c["team"] != idx:
				continue
			total += 1
			max_hp += int(c["max_hp"])
			if c["alive"]:
				alive += 1
				hp += int(c["hp"])
		out.append(
			{
				"index": idx,
				"name": t["name"],
				"color": t["color"],
				"alive": alive,
				"total": total,
				"hp": hp,
				"max_hp": max_hp,
				"fraction": clampf(float(hp) / float(max_hp), 0.0, 1.0) if max_hp > 0 else 0.0,
				"out": alive == 0,
				"active": v["active_team"] != null and v["active_team"] == idx and v["phase"] != "over",
			}
		)
	return out


## Teams still in the game, starting with the active team and cycling after it.
static func turn_order(v: Dictionary) -> Array:
	var alive: Array = []
	for s in summarize_teams(v):
		if not s["out"]:
			alive.append(s["index"])
	if alive.is_empty():
		return []
	var from: int = alive[0] if v["active_team"] == null else int(v["active_team"])
	var start := 0
	var found := false
	for i in range(alive.size()):
		if int(alive[i]) >= from:
			start = i
			found = true
			break
	if not found:
		start = 0
	return alive.slice(start) + alive.slice(0, start)


## Wind as {heading_deg, strength 0..1}. Heading 0 = +z, 90 = +x.
static func wind_streamer(w: Vector2) -> Dictionary:
	var mag := w.length()
	var heading := 0.0
	if mag > 0.0:
		heading = fposmod(rad_to_deg(atan2(w.x, w.y)), 360.0)
	return {"heading_deg": heading, "strength": minf(1.0, mag / 100.0)}


static func compass(heading_deg: float) -> String:
	var names := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
	return names[int(roundf(fposmod(heading_deg, 360.0) / 45.0)) % 8]


static func turn_banner(v: Dictionary) -> String:
	var winner = v["winner_team"]
	if v["phase"] == "over":
		if winner == null:
			return "Draw!"
		return "%s wins!" % _team_name(v, int(winner))
	var team := ""
	if v["active_team"] != null:
		team = _team_name(v, int(v["active_team"]))
	if v["phase"] == "retreat":
		return "%s: run for cover!" % team
	if v["phase"] == "settling":
		return "Waiting for things to settle..."
	for c in v["critters"]:
		if v["active_critter_id"] != null and c["id"] == int(v["active_critter_id"]):
			return "%s's turn: %s" % [team, c["name"]]
	return "%s's turn" % team


static func _team_name(v: Dictionary, index: int) -> String:
	for t in v["teams"]:
		if t["index"] == index:
			return str(t["name"])
	return TeamStyle.name_of(index)


## Final table for the results screen: winner first, then by teams alive, then total health.
## Each row is a summarize_teams row plus "rank" (1 = best) and "winner".
static func standings(v: Dictionary) -> Array:
	var rows := summarize_teams(v)
	var winner = v["winner_team"]
	rows.sort_custom(
		func(a: Dictionary, b: Dictionary) -> bool:
			var aw: bool = winner != null and a["index"] == winner
			var bw: bool = winner != null and b["index"] == winner
			if aw != bw:
				return aw
			if a["alive"] != b["alive"]:
				return a["alive"] > b["alive"]
			if a["hp"] != b["hp"]:
				return a["hp"] > b["hp"]
			return a["index"] < b["index"]
	)
	for i in range(rows.size()):
		rows[i]["rank"] = i + 1
		rows[i]["winner"] = winner != null and rows[i]["index"] == winner
	return rows
