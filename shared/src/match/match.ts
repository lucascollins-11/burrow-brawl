// The deterministic match model shared by the server (authoritative) and
// every client (mirror). One step = one 60 Hz tick: apply that tick's relayed
// commands, run stepWorld, then the turn controller. Same config + same
// commands at the same ticks => same state hash everywhere.

import { Prng, StateHasher, type PrngState } from "../determinism";
import { createCritter, createWorld, findSurfaceY, stepWorld } from "../sim";
import type { Critter, CritterInput, SimEvent, SimState } from "../sim";
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
 * - fire: one-shot; until weapons (S4) exist it only ends control and starts retreat
 * - skip: end the turn now
 */
export type Cmd =
  | { k: "move"; dir: -1 | 0 | 1 }
  | { k: "jump" }
  | { k: "backflip" }
  | { k: "fire" }
  | { k: "skip" };

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
    case "fire":
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
  return {
    sim,
    turns: turns.init(sim, rulesFor(cfg), 0, rng),
    rng: rng.getState(),
    move: 0,
  };
}

/** The sim input for this tick's active critter, from held move + one-shots. */
function inputFor(critterId: number, move: -1 | 0 | 1, cmds: readonly Cmd[]): CritterInput {
  let jump = false;
  let backflip = false;
  for (const c of cmds) {
    if (c.k === "jump") jump = true;
    if (c.k === "backflip") backflip = true;
  }
  return { critterId, move, jump, backflip };
}

/**
 * Advance one tick with the commands stamped for it. Commands are ignored
 * unless someone has control, so stale or late commands can't desync.
 * Mutates only the terrain (shared, as in stepWorld).
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
  // The turn controller owns wind; the sim (projectiles, S4) reads SimState.wind.
  const sim = { ...state.sim, wind: ts.wind } as SimState;
  const r = stepWorld(sim, inputs, rng);
  const next = turns.update(ts, rules, r.state, r.events, r.state.tick, rng);
  const turnChanged =
    next.turn !== state.turns.turn || (next.phase === "over") !== (state.turns.phase === "over");
  return {
    state: { sim: r.state, turns: next, rng: rng.getState(), move: turnChanged ? 0 : move },
    events: r.events,
    turnChanged,
  };
}

// ------------------------------------------------------------ hashing

/** u32 hash of the full match state (protocol section 7). */
export function hashMatch(state: MatchState): number {
  const h = new StateHasher();
  // Every sim field except the terrain goes through the canonical hasher, so
  // fields added later (projectiles, crates) are covered automatically.
  const { terrain, ...rest } = state.sim;
  h.i32(hashTerrain(terrain)).value(rest);
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
