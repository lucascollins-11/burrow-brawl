class_name ViewModel
extends RefCounted
## What the server last told us about the match (docs/view-protocol.md), kept as two samples per
## moving thing so the scene can draw between them. The client never simulates: positions, health and
## turns come only from `state` messages. Units: sim Q16.16 integers are divided by 65536 into voxels
## (one voxel is one Godot unit), y up.

const FIXED_ONE := 65536.0
const TICKS_PER_SECOND := 60.0
## The render clock trails the newest state by this many ticks (50 ms) to stay between two samples.
const RENDER_DELAY_TICKS := 3.0
const MAX_HP_DEFAULT := 100

var match_id: String = ""
var config: Dictionary = {}
var team_ids: Array = []
var teams: Array = []  # [{index, name, color, hat}]
var local_teams: Array = []  # sim team indexes controlled by this client
var turns: Dictionary = {}
var sea_y: float = 0.0
## Shots left per sim team: weapon id -> count, limited weapons only. Empty with an older server.
var ammo: Array = []
## Crates on the map as the server sent them: [{id, kind, weaponId, x, y, z}] in voxels.
var crates: Array = []
var latest_tick: int = 0
var max_hp: int = MAX_HP_DEFAULT
var started: bool = false

var _critters: Dictionary = {}  # id -> {id, team, hp, status, grounded, a, b, ta, tb, yaw_a, yaw_b}
var _projectiles: Dictionary = {}  # id -> {id, owner, weapon, a, b, ta, tb, fuse}
var _zones: Array = []  # [{id, kind, pos, r, turns}] as last sent
var _mines: Array = []  # [{id, weapon, pos, armed, triggered}] as last sent
var _events: Array = []
var _render_tick: float = 0.0


func set_teams(looks: Array) -> void:
	teams = looks.duplicate()


func set_local_teams(indexes: Array) -> void:
	local_teams = indexes.duplicate()


## match.start: always complete, so throw away everything we had.
func apply_match_start(msg: Dictionary) -> void:
	_critters.clear()
	_projectiles.clear()
	_events.clear()
	ammo = []
	crates = []
	match_id = str(msg.get("matchId", ""))
	config = msg.get("config", {})
	team_ids = msg.get("teamIds", [])
	max_hp = int(config.get("startHealth", MAX_HP_DEFAULT))
	var state: Dictionary = msg.get("state", {})
	apply_state(state, true)
	_render_tick = float(latest_tick)
	if teams.size() < team_ids.size():
		teams = []
		for i in range(team_ids.size()):
			teams.append(TeamStyle.default_look(i))
	started = true


## Crates for drawing: [{id, kind, weapon, pos}], pos at the middle of the crate's floor.
func crate_list() -> Array:
	var out: Array = []
	for c in crates:
		if not (c is Dictionary):
			continue
		out.append(
			{
				"id": int(c.get("id", 0)),
				"kind": str(c.get("kind", "weapon")),
				"weapon": str(c.get("weaponId", "")),
				"pos": Vector3(float(c.get("x", 0)) + 0.5, float(c.get("y", 0)), float(c.get("z", 0)) + 0.5),
			}
		)
	return out


## Shots left for a team: weapon id -> count. A weapon that is not in it is unlimited.
func team_ammo(team: int) -> Dictionary:
	if team < 0 or team >= ammo.size() or not (ammo[team] is Dictionary):
		return {}
	return ammo[team]


## How many shots a team has left with a weapon, or -1 for unlimited.
func ammo_left(team: int, weapon_id: String) -> int:
	return int(team_ammo(team).get(weapon_id, -1))


## Voxels a critter can not cover in one state batch by moving.
const TELEPORT_DISTANCE := 40.0


## state: critters are only the ones that changed, projectiles are always the full list.

func apply_state(msg: Dictionary, snap := false) -> void:
	var tick := int(msg.get("tick", latest_tick))
	latest_tick = maxi(latest_tick, tick)
	turns = msg.get("turns", turns)
	sea_y = float(msg.get("seaY", sea_y))
	if msg.has("ammo"):
		ammo = msg["ammo"]
	if msg.has("crates"):
		crates = msg["crates"]
	for c in msg.get("critters", []):
		var id := int(c["id"])
		var pos := _pos(c)
		var yaw := CameraMath.yaw_to_deg(int(c.get("yaw", 0)))
		var e: Dictionary = _critters.get(id, {})
		# A jump this long in one batch is a burrow, not a move: appear there, do not slide.
		if e.is_empty() or snap or (e["b"] as Vector3).distance_to(pos) > TELEPORT_DISTANCE:
			e = {"id": id, "a": pos, "b": pos, "ta": tick, "tb": tick, "yaw_a": yaw, "yaw_b": yaw}
		else:
			e["a"] = e["b"]
			e["ta"] = e["tb"]
			e["yaw_a"] = e["yaw_b"]
			e["b"] = pos
			e["tb"] = tick
			e["yaw_b"] = yaw
		e["team"] = int(c.get("team", e.get("team", 0)))
		e["hp"] = int(c.get("hp", 0))
		e["status"] = str(c.get("status", "alive"))
		e["grounded"] = bool(c.get("grounded", true))
		# Utilities and the shield are only listed while they last, so a missing key clears them.
		e["act"] = str(c.get("act", ""))
		e["fuel"] = int(c.get("fuel", 0))
		e["anchor"] = _pos(c["anchor"]) if c.get("anchor") is Dictionary else Vector3.INF
		e["shield"] = bool(c.get("shield", false))
		e["frozen"] = bool(c.get("frozen", false))
		e["feather"] = bool(c.get("feather", false))
		_critters[id] = e
	var seen := {}
	for p in msg.get("projectiles", []):
		var id := int(p["id"])
		seen[id] = true
		var pos := _pos(p)
		var e: Dictionary = _projectiles.get(id, {})
		if e.is_empty():
			e = {"id": id, "a": pos, "b": pos, "ta": tick, "tb": tick}
		else:
			e["a"] = e["b"]
			e["ta"] = e["tb"]
			e["b"] = pos
			e["tb"] = tick
		e["owner"] = int(p.get("ownerId", 0))
		e["weapon"] = str(p.get("weaponId", ""))
		e["fuse"] = int(p.get("fuseTicks", -1))
		# Steered shots (robot, racer, kite) say which way they face, in yaw steps.
		e["heading"] = CameraMath.yaw_to_deg(int(p["heading"])) if p.has("heading") else INF
		_projectiles[id] = e
	for id in _projectiles.keys():
		if not seen.has(id):
			_projectiles.erase(id)
	# Puddles are the full list too; no list means none.
	_zones = []
	for z in msg.get("zones", []):
		_zones.append(
			{
				"id": int(z["id"]),
				"kind": str(z.get("kind", "fire")),
				"pos": Vector3(float(z.get("x", 0)) + 0.5, float(z.get("y", 0)), float(z.get("z", 0)) + 0.5),
				"r": float(z.get("r", 1)),
				"turns": int(z.get("turns", 0)),
			}
		)
	# Placed mines are always the full list; no list means none.
	_mines = []
	for m in msg.get("mines", []):
		_mines.append(
			{
				"id": int(m["id"]),
				"weapon": str(m.get("weaponId", "jelly-mine")),
				"pos": _pos(m),
				"armed": bool(m.get("armed", false)),
				"triggered": bool(m.get("triggered", false)),
			}
		)


func apply_events(msg: Dictionary) -> void:
	for e in msg.get("events", []):
		_events.append(e)


## Events received since the last call (jumped, landed, damage, died, fired, bounced, explosion...).
func take_events() -> Array:
	var out := _events
	_events = []
	return out


## Advance the render clock by real seconds. It runs at sim speed and is pulled back in if it drifts.
func advance(dt: float) -> void:
	_render_tick += dt * TICKS_PER_SECOND
	var target := float(latest_tick) - RENDER_DELAY_TICKS
	if _render_tick > float(latest_tick):
		_render_tick = float(latest_tick)
	elif _render_tick < target - 6.0:
		_render_tick = target


func render_tick() -> float:
	return _render_tick


## A sim point {x, y, z} in Q16.16 voxels, as Godot units.
static func point(d: Dictionary) -> Vector3:
	return Vector3(float(d.get("x", 0)), float(d.get("y", 0)), float(d.get("z", 0))) / FIXED_ONE


static func _pos(d: Dictionary) -> Vector3:
	return Vector3(float(d["x"]), float(d["y"]), float(d["z"])) / FIXED_ONE


static func _lerp_between(a: Vector3, b: Vector3, ta: int, tb: int, t: float) -> Vector3:
	if tb <= ta:
		return b
	return a.lerp(b, clampf((t - float(ta)) / float(tb - ta), 0.0, 1.0))


## Everything the scene and HUD draw, with positions interpolated to the render clock.
func snapshot() -> Dictionary:
	var crit: Array = []
	var ids := _critters.keys()
	ids.sort()
	for id in ids:
		var e: Dictionary = _critters[id]
		var pos := _lerp_between(e["a"], e["b"], e["ta"], e["tb"], _render_tick)
		var yaw_a: float = e["yaw_a"]
		var yaw := CameraMath.wrap_deg(
			yaw_a + CameraMath.angle_delta(yaw_a, e["yaw_b"]) * _blend(e["ta"], e["tb"])
		)
		crit.append(
			{
				"id": id,
				"team": e["team"],
				"name": CritterNames.name_of(int(id)),
				"pos": pos,
				"heading_deg": yaw,
				"hp": e["hp"],
				"max_hp": max_hp,
				"alive": e["status"] == "alive",
				"grounded": e["grounded"],
				"act": e["act"],
				"fuel": e["fuel"],
				"anchor": e["anchor"],
				"shield": e["shield"],
				"frozen": e["frozen"],
				"feather": e["feather"],
			}
		)
	var shots: Array = []
	for id in _projectiles.keys():
		var p: Dictionary = _projectiles[id]
		shots.append(
			{
				"id": id,
				"weapon": p["weapon"],
				"pos": _lerp_between(p["a"], p["b"], p["ta"], p["tb"], _render_tick),
				"heading_deg": p["heading"],
			}
		)
	var active_team = turns.get("activeTeam", null)
	var phase: String = str(turns.get("phase", "control"))
	var phase_end := int(turns.get("phaseEndTick", 0))
	return {
		"teams": teams,
		"critters": crit,
		"projectiles": shots,
		"mines": _mines.duplicate(),
		"zones": _zones.duplicate(),
		"crates": crate_list(),
		"active_critter_id": turns.get("activeCritter", null),
		"active_team": active_team,
		"phase": phase,
		"round": int(turns.get("round", 1)),
		"turn": int(turns.get("turn", 0)),
		"time_left": maxf(0.0, float(phase_end) - _render_tick) / TICKS_PER_SECOND,
		# In a storm a gust rides on the turn's wind (shared/src/match/gusts.ts): show what the sim feels.
		"wind": Vector2(
			clampf(float(turns.get("windX", 0)) + float(turns.get("gustX", 0)), -100.0, 100.0),
			clampf(float(turns.get("windZ", 0)) + float(turns.get("gustZ", 0)), -100.0, 100.0)
		),
		"sea_y": sea_y,
		"winner_team": turns.get("winnerTeam", null),
		"my_turn": active_team != null and local_teams.has(int(active_team)),
		"local_teams": local_teams,
	}


func _blend(ta: int, tb: int) -> float:
	if tb <= ta:
		return 1.0
	return clampf((_render_tick - float(ta)) / float(tb - ta), 0.0, 1.0)
