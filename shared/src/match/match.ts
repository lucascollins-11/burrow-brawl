// The deterministic match model shared by the server (authoritative) and
// every client (mirror). One step = one 60 Hz tick: apply that tick's relayed
// commands, run stepWorld, then the turn controller. Same config + same
// commands at the same ticks => same state hash everywhere.

import { Prng, StateHasher, type PrngState } from "../determinism";
import { createCritter, createWorld, findSurfaceY, isProjectileWeapon, stepWorld } from "../sim";
import type { Critter, CritterInput, FireCommand, Projectile, SimEvent, SimState } from "../sim";
import { basicTurns, type TurnController, type TurnRules, type TurnState } from "../sim/turns";
import {
  createDemoTerrain,
  deserializeTerrain,
  hashTerrain,
  serializeTerrain,
  type Terrain,
} from "../terrain";
import { fromBase64, toBase64 } from "./base64";

// ------------------------------------------------------------ commands

/**
 * What the active player sends. Commands are game-level intents; the match
 * maps them onto the sim's CritterInput (see `inputFor`).
 *
 * - move: held direction, stays in effect until changed or the turn ends
 * - jump / backflip: one-shot, applied on the tick they're stamped for
 * - fire: one-shot; launches a projectile weapon (angle in whole degrees, 0 = right, 90 = up;
 *   power 0..100; fuse in whole seconds for timed weapons) and starts the retreat phase
 * - skip: end the turn now
 */
export type Cmd =
  | { k: "move"; dir: -1 | 0 | 1 }
  | { k: "jump" }
  | { k: "backflip" }
  | {
      k: "fire";
      weapon: "acorn-mortar" | "fizz-grenade";
      angle: number;
      power: number;
      fuse?: number;
    }
  | { k: "skip" };

export const MAX_CMDS_PER_INPUT = 16;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function isCmd(v: unknown): v is Cmd {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  switch (o.k) {
    case "move":
      return keys.length === 2 && (o.dir === -1 || o.dir === 0 || o.dir === 1);
    case "fire":
      return (
        isProjectileWeapon(String(o.weapon)) &&
        isInt(o.angle, 0, 359) &&
        isInt(o.power, 0, 100) &&
        (o.fuse === undefined || isInt(o.fuse, 1, 5)) &&
        keys.length === (o.fuse === undefined ? 4 : 5)
      );
    case "jump":
    case "backflip":
    case "skip":
      return keys.length === 1;
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
  /** Sudden death: from this round on the soda rises every turn. 0 or absent = off. */
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
export function createMatch(cfg: MatchConfig, turns: TurnController = basicTurns): MatchState {
  const rng = Prng.fromSeed(cfg.seed);
  const terrain = createDemoTerrain(cfg.mapWidth, cfg.mapHeight);
  const spawnRng = rng.fork("spawn");
  const margin = 80;
  const spacing = 40;
  const taken: number[] = [];
  const critters: Critter[] = [];
  let id = 1;
  // Interleave teams so nobody gets all the high ground.
  const maxSize = Math.max(...cfg.teamSizes);
  for (let i = 0; i < maxSize; i++) {
    for (let team = 0; team < cfg.teamSizes.length; team++) {
      if (i >= (cfg.teamSizes[team] ?? 0)) continue;
      let x = margin;
      for (let tries = 0; tries < 64; tries++) {
        x = spawnRng.nextRange(margin, cfg.mapWidth - margin);
        if (taken.every((t) => Math.abs(t - x) >= spacing) && findSurfaceY(terrain, x) > 0) break;
      }
      taken.push(x);
      const c = createCritter(id++, team, x, findSurfaceY(terrain, x));
      critters.push({ ...c, hp: cfg.startHealth });
    }
  }
  const sim = createWorld(terrain, critters, cfg.mapHeight - 40);
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
    if (c.k === "fire" && fire === undefined) {
      fire = {
        weaponId: c.weapon,
        angleDeg: c.angle,
        power: c.power,
        ...(c.fuse === undefined ? {} : { fuseSeconds: c.fuse }),
      };
    }
  }
  return { critterId, move, jump, backflip, ...(fire ? { fire } : {}) };
}

/**
 * Advance one tick with the commands stamped for it. Commands are ignored
 * unless someone has control, so stale or late commands can't desync.
 * Pure: an explosion works on a copy of the terrain (see stepWorld), so `state` is never modified.
 */
export function stepMatch(
  cfg: MatchConfig,
  state: MatchState,
  cmds: readonly Cmd[],
  turns: TurnController = basicTurns,
): StepOutput {
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
    else if (cmds.some((c) => c.k === "fire")) ts = turns.endTurn(ts, rules, "fired", tick);
  }
  if (turns.activeTeam(ts) === null) inputs.length = 0;
  if (turns.activeTeam(ts) === null) move = 0;

  const rng = Prng.fromState(state.rng);
  // Wind belongs to the turn controller; the sim just reads it each tick.
  const r = stepWorld({ ...state.sim, wind: ts.wind }, inputs, rng);
  const next = turns.update(ts, rules, r.state, r.events, r.state.tick, rng);
  const turnChanged =
    next.turn !== state.turns.turn || (next.phase === "over") !== (state.turns.phase === "over");
  let sim: SimState = { ...r.state, wind: next.wind };
  // Sudden death (stub): once the round limit passes, the soda rises at the start of every turn.
  if (
    turnChanged &&
    next.phase !== "over" &&
    (cfg.suddenDeathRound ?? 0) > 0 &&
    next.round > (cfg.suddenDeathRound ?? 0)
  ) {
    sim = { ...sim, waterY: Math.max(0, sim.waterY - (cfg.waterRisePerTurn ?? 8)) };
  }
  return {
    state: { sim, turns: next, rng: rng.getState(), move: turnChanged ? 0 : move },
    events: r.events,
    turnChanged,
  };
}

// ------------------------------------------------------------ hashing

/** u32 hash of the full match state (protocol section 7). */
export function hashMatch(state: MatchState): number {
  const h = new StateHasher();
  const s = state.sim;
  h.int(s.tick).int(s.waterY).i32(s.wind).i32(s.nextProjectileId);
  h.i32(hashTerrain(s.terrain)).i32(s.critters.length);
  for (const c of s.critters) {
    h.i32(c.id).i32(c.team).i32(c.x).i32(c.y).i32(c.vx).i32(c.vy).i32(c.facing).i32(c.hp);
    h.str(c.status).bool(c.grounded).i32(c.peakY);
  }
  h.i32(s.projectiles.length);
  for (const p of s.projectiles) {
    h.i32(p.id).i32(p.ownerId).str(p.weaponId).i32(p.x).i32(p.y).i32(p.vx).i32(p.vy);
    h.i32(p.age).i32(p.fuseTicks).i32(p.bounces).bool(p.resting);
  }
  h.value(state.turns);
  for (const w of state.rng) h.i32(w);
  h.i32(state.move);
  return h.digest();
}

// ------------------------------------------------------------ snapshots

/** JSON-safe full state, as sent in `snapshot` and `match.start`. */
export interface MatchSnapshot {
  tick: number;
  waterY: number;
  critters: Critter[];
  projectiles: Projectile[];
  nextProjectileId: number;
  wind: number;
  /** serializeTerrain() output, base64. */
  terrain: string;
  turns: TurnState;
  rng: [number, number, number, number];
  move: -1 | 0 | 1;
}

export function saveMatch(state: MatchState): MatchSnapshot {
  return {
    tick: state.sim.tick,
    waterY: state.sim.waterY,
    critters: state.sim.critters.map((c) => ({ ...c })),
    projectiles: state.sim.projectiles.map((p) => ({ ...p })),
    nextProjectileId: state.sim.nextProjectileId,
    wind: state.sim.wind,
    terrain: toBase64(serializeTerrain(state.sim.terrain)),
    turns: structuredClone(state.turns),
    rng: [...state.rng] as [number, number, number, number],
    move: state.move,
  };
}

export function loadMatch(snap: MatchSnapshot): MatchState {
  const terrain: Terrain = deserializeTerrain(fromBase64(snap.terrain));
  const sim: SimState = {
    tick: snap.tick,
    waterY: snap.waterY,
    critters: snap.critters.map((c) => ({ ...c })),
    terrain,
    projectiles: snap.projectiles.map((p) => ({ ...p })),
    nextProjectileId: snap.nextProjectileId,
    wind: snap.wind,
  };
  return {
    sim,
    turns: structuredClone(snap.turns),
    rng: Prng.fromState(snap.rng).getState(),
    move: snap.move,
  };
}
