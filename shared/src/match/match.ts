// The deterministic match model shared by the server (authoritative) and
// every client (mirror). One step = one 60 Hz tick: apply that tick's relayed
// commands, run stepWorld, then the turn controller. Same config + same
// commands at the same ticks => same state hash everywhere.

import { generateMap } from "../maps/generate";
import { Prng, StateHasher, type PrngState } from "../determinism";
import { createCritter, createWorld, maybeDropCrate, releaseRopes, stepWorld } from "../sim";
import type { Critter, CritterInput, FireCommand, SimEvent, SimState } from "../sim";
import type { WeaponId } from "../weapons/load";
import { basicTurns, type TurnRules, type TurnState } from "../sim/turns";
import { deserializeTerrain, hashTerrain, serializeTerrain, type Terrain } from "../terrain";
import { fromBase64, toBase64 } from "./base64";

// ------------------------------------------------------------ commands

/**
 * What the active player sends. Commands are game-level intents; the match
 * maps them onto the sim's CritterInput (see `inputFor`).
 *
 * - move: held direction, stays in effect until changed or the turn ends
 * - jump / backflip: one-shot, applied on the tick they're stamped for
 * - fire: one-shot; passed to the sim as CritterInput.fire. If the sim reports
 *   a "fired" event for the active critter, control ends and retreat starts.
 *   Unsupported weapons do nothing and the turn continues.
 * - skip: end the turn now
 */
export type Cmd =
  | { k: "move"; dir: -1 | 0 | 1 }
  | { k: "jump" }
  | { k: "backflip" }
  | ({ k: "fire" } & FireCommand)
  | { k: "skip" };

const WEAPON_IDS = [
  "acorn-mortar",
  "fizz-grenade",
  "pepper-shotgun",
  "root-punch",
  "spring-boots",
  "rope-claw",
  "drill-hat",
  "beehive-strike",
  "jelly-mine",
  "boulder-of-doom",
  "teleport-burrow",
  "skip-turn",
] as const satisfies readonly WeaponId[];

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const MAX_CMDS_PER_INPUT = 16;

export function isCmd(v: unknown): v is Cmd {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  switch (o.k) {
    case "move":
      return keys.length === 2 && (o.dir === -1 || o.dir === 0 || o.dir === 1);
    case "jump":
    case "backflip":
    case "skip":
      return keys.length === 1;
    case "fire":
      return (
        keys.every((k) => ["k", "weaponId", "angleDeg", "power", "fuseSeconds"].includes(k)) &&
        (WEAPON_IDS as readonly unknown[]).includes(o.weaponId) &&
        isIntIn(o.angleDeg, 0, 359) &&
        isIntIn(o.power, 0, 100) &&
        (o.fuseSeconds === undefined || isIntIn(o.fuseSeconds, 1, 5))
      );
    default:
      return false;
  }
}

// ------------------------------------------------------------ config and state

export interface MatchConfig {
  seed: number;
  /** Critters per team, one entry per team (2..4 teams). */
  teamSizes: number[];
  turnTicks: number;
  retreatTicks: number;
  settleCapTicks: number;
  startHealth: number;
  /** Wind range per turn (0 = off). */
  windMax: number;
  mapWidth: number;
  mapHeight: number;
  /** Sudden death: from the round after this one the soda rises every turn. 0 or absent = off. */
  suddenDeathRound?: number;
  /** Cells the soda line rises per turn once sudden death starts. Default 8. */
  waterRisePerTurn?: number;
}

export interface MatchState {
  sim: SimState;
  turns: TurnState;
  rng: PrngState;
  /** Active critter's held move. Reset on every new turn. */
  move: -1 | 0 | 1;
}

export interface StepOutput {
  state: MatchState;
  events: readonly SimEvent[];
  /** True when this step started a new turn (or ended the match). */
  turnChanged: boolean;
}

/**
 * The one turn controller every match uses (server, clients, hot-seat). There
 * is deliberately no way to pass a different one: two controllers would
 * silently desync. Edit it in place in shared/src/sim/turns.ts.
 */
export const MATCH_TURNS = basicTurns;

export const TICKS_PER_SECOND = 60;
/** The server broadcasts a state hash on every tick divisible by this (protocol section 7). */
export const HASH_EVERY = 30;

export function rulesFor(cfg: MatchConfig): TurnRules {
  return {
    teams: cfg.teamSizes.length,
    turnTicks: cfg.turnTicks,
    retreatTicks: cfg.retreatTicks,
    settleCapTicks: cfg.settleCapTicks,
    windMax: cfg.windMax,
  };
}

/** Build the initial match. Pure function of the config (map, spawns, first turn). */
export function createMatch(cfg: MatchConfig): MatchState {
  const turns = MATCH_TURNS;
  const rng = Prng.fromSeed(cfg.seed);
  const total = cfg.teamSizes.reduce((a, b) => a + b, 0);
  // Fit every critter on the map: wide spacing for few critters, tighter for many. If the
  // generator still finds too few spawn columns, retry with half the spacing (deterministic).
  let spacing = Math.max(40, Math.min(160, Math.floor((cfg.mapWidth - 200) / Math.max(1, total))));
  let map = generateMap(rng.fork("map"), {
    width: cfg.mapWidth,
    height: cfg.mapHeight,
    spawnCount: total,
    minSpawnSpacing: spacing,
  });
  for (let i = 0; i < 3 && map.spawns.length < total; i++) {
    spacing = Math.max(12, spacing >> 1);
    map = generateMap(rng.fork("map"), {
      width: cfg.mapWidth,
      height: cfg.mapHeight,
      spawnCount: total,
      minSpawnSpacing: spacing,
    });
  }
  const terrain = map.terrain;
  const critters: Critter[] = [];
  let id = 1;
  let spawnIndex = 0;
  // Interleave teams so nobody gets all the high ground.
  const maxSize = Math.max(...cfg.teamSizes);
  for (let i = 0; i < maxSize; i++) {
    for (let team = 0; team < cfg.teamSizes.length; team++) {
      if (i >= (cfg.teamSizes[team] ?? 0)) continue;
      const sp = map.spawns[spawnIndex++];
      // Never stack critters on a fallback spot: a map too small for the match is a config error.
      if (!sp) {
        throw new RangeError(
          `map ${cfg.mapWidth}x${cfg.mapHeight} has room for ${map.spawns.length} critters, need ${total}`,
        );
      }
      const c = createCritter(id++, team, sp.x, sp.y);
      critters.push({ ...c, hp: cfg.startHealth });
    }
  }
  const sim = createWorld(terrain, critters, map.waterY);
  const first = turns.init(sim, rulesFor(cfg), 0, rng);
  return {
    sim: { ...sim, wind: first.wind },
    turns: first,
    rng: rng.getState(),
    move: 0,
  };
}

/** The sim input for this tick's active critter, from held move + one-shots. */
function inputFor(critterId: number, move: -1 | 0 | 1, cmds: readonly Cmd[]): CritterInput {
  let jump = false;
  let backflip = false;
  let fire: FireCommand | undefined;
  for (const c of cmds) {
    if (c.k === "jump") jump = true;
    if (c.k === "backflip") backflip = true;
    if (c.k === "fire" && !fire) {
      fire = {
        weaponId: c.weaponId,
        angleDeg: c.angleDeg,
        power: c.power,
        ...(c.fuseSeconds === undefined ? {} : { fuseSeconds: c.fuseSeconds }),
      };
    }
  }
  return fire ? { critterId, move, jump, backflip, fire } : { critterId, move, jump, backflip };
}

/**
 * Advance one tick with the commands stamped for it. Commands are ignored
 * unless someone has control, so stale or late commands can't desync.
 * Mutates only the terrain (shared, as in stepWorld).
 */
export function stepMatch(cfg: MatchConfig, state: MatchState, cmds: readonly Cmd[]): StepOutput {
  const turns = MATCH_TURNS;
  const rules = rulesFor(cfg);
  const tick = state.sim.tick + 1;
  let ts = state.turns;
  let move = state.move;
  const controlling = turns.activeTeam(ts) !== null && ts.activeCritter !== null;

  const inputs: CritterInput[] = [];
  if (controlling) {
    for (const c of cmds) if (c.k === "move") move = c.dir;
    inputs.push(inputFor(ts.activeCritter!, move, cmds));
    if (cmds.some((c) => c.k === "skip")) ts = turns.endTurn(ts, rules, "skip", tick);
  }
  // Only one shot per turn: no firing during retreat.
  if (ts.phase === "retreat" && inputs[0]?.fire) {
    const { fire: _drop, ...rest } = inputs[0];
    void _drop;
    inputs[0] = rest;
  }
  if (turns.activeTeam(ts) === null) inputs.length = 0;
  if (turns.activeTeam(ts) === null) move = 0;

  const rng = Prng.fromState(state.rng);
  // The turn controller owns wind; the sim (projectiles, S4) reads SimState.wind.
  const sim = { ...state.sim, wind: ts.wind } as SimState;
  const r = stepWorld(sim, inputs, rng);
  if (r.events.some((e) => e.type === "fired" && e.critterId === ts.activeCritter)) {
    ts = turns.endTurn(ts, rules, "fired", tick);
  }
  const next = turns.update(ts, rules, r.state, r.events, r.state.tick, rng);
  const turnChanged =
    next.turn !== state.turns.turn || (next.phase === "over") !== (state.turns.phase === "over");
  let simOut: SimState = { ...r.state, wind: next.wind };
  // Sudden death: once the round limit passes, the soda rises at the start of every turn.
  const sdRound = cfg.suddenDeathRound ?? 0;
  if (turnChanged && next.phase !== "over" && sdRound > 0 && next.round > sdRound) {
    simOut = { ...simOut, waterY: Math.max(0, simOut.waterY - (cfg.waterRisePerTurn ?? 8)) };
  }
  let events: readonly SimEvent[] = r.events;
  // Ropes let go when control ends; a crate may drop whenever a turn starts (rolled from the match rng).
  if (next.phase !== "control" && next.phase !== "retreat") simOut = releaseRopes(simOut);
  if (turnChanged && next.phase !== "over") {
    const drop = maybeDropCrate(simOut, rng);
    simOut = drop.sim;
    if (drop.events.length > 0) events = [...events, ...drop.events];
  }
  return {
    state: { sim: simOut, turns: next, rng: rng.getState(), move: turnChanged ? 0 : move },
    events,
    turnChanged,
  };
}

// ------------------------------------------------------------ hashing

const terrainHashes = new WeakMap<Terrain, { version: number; h: number }>();

/**
 * hashTerrain walks every cell (2M on a full map), so cache it per terrain
 * and recompute only after a change. The key is the sum of chunkVersion,
 * which every carve/fill bumps.
 */
function cachedTerrainHash(t: Terrain): number {
  let version = 0;
  for (let i = 0; i < t.chunkVersion.length; i++) version = (version + t.chunkVersion[i]!) >>> 0;
  const hit = terrainHashes.get(t);
  if (hit && hit.version === version) return hit.h;
  const h = hashTerrain(t);
  terrainHashes.set(t, { version, h });
  return h;
}

/** u32 hash of the full match state (protocol section 7). */
export function hashMatch(state: MatchState): number {
  const h = new StateHasher();
  // Every sim field except the terrain goes through the canonical hasher, so
  // fields added later (projectiles, crates) are covered automatically.
  const { terrain, ...rest } = state.sim;
  h.i32(cachedTerrainHash(terrain)).value(rest);
  h.value(state.turns);
  for (const w of state.rng) h.i32(w);
  h.i32(state.move);
  return h.digest();
}

// ------------------------------------------------------------ snapshots

/** JSON-safe full state, as sent in `snapshot` and `match.start`. */
export interface MatchSnapshot {
  /** Every SimState field except terrain (tick, critters, waterY, and whatever S4+ adds). */
  sim: Omit<SimState, "terrain">;
  /** serializeTerrain() output, base64. */
  terrain: string;
  turns: TurnState;
  rng: [number, number, number, number];
  move: -1 | 0 | 1;
}

export function saveMatch(state: MatchState): MatchSnapshot {
  const { terrain, ...rest } = state.sim;
  return {
    sim: structuredClone(rest),
    terrain: toBase64(serializeTerrain(terrain)),
    turns: structuredClone(state.turns),
    rng: [...state.rng] as [number, number, number, number],
    move: state.move,
  };
}

export function loadMatch(snap: MatchSnapshot): MatchState {
  const terrain: Terrain = deserializeTerrain(fromBase64(snap.terrain));
  const sim = { ...structuredClone(snap.sim), terrain } as SimState;
  return {
    sim,
    turns: structuredClone(snap.turns),
    rng: Prng.fromState(snap.rng).getState(),
    move: snap.move,
  };
}
