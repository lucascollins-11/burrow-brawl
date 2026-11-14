// The deterministic match model shared by the server (authoritative), every client (mirror) and
// hot-seat play. One step = one 60 Hz tick: apply that tick's commands, run the 3D sim, then the
// turn controller. Same config + same commands at the same ticks => same state hash everywhere.

import { Prng, StateHasher, type PrngState } from "../determinism";
import { FIXED_ONE } from "../fixed";
import type { Critter, CritterInput, FireCommand, SimEvent, SimState } from "../sim3d/api";
import { PITCH_MAX, PITCH_MIN, YAW_STEPS } from "../sim3d/api";
import { MAX_HEALTH } from "../sim3d/constants";
import { zonesTurnEnd } from "../sim3d/zones";
import { createCritter, createWorld, stepWorld } from "../sim3d/world";
import type { MapRecipe, TerrainEdit } from "../terrain3d/api";
import {
  GENERATOR_VERSION,
  MAP_SIZES,
  THEMES,
  generate,
  hash as hashTerrain,
  restore,
  themedRecipe,
} from "../terrain3d/impl";
import { weaponCatalog } from "../weapons/catalog";
import { loadWeapons, type WeaponId } from "../weapons/load";
import {
  CRATE_CHANCE_DEN,
  CRATE_CHANCE_NUM,
  CRATE_HEAL,
  MAX_CRATES,
  collectCrates,
  dropCrate,
  settleCrates,
  type Crate,
} from "./crates";
import { basicTurns, type TurnRules, type TurnState } from "./turns";

// ------------------------------------------------------------ commands

/**
 * What the active player sends. Commands are game-level intents; the match maps them onto the
 * sim's CritterInput (see `inputFor`). The sim never sees the camera: the client turns
 * camera-relative keys into the integer headings here before sending.
 *
 * - move: walk heading 0..YAW_STEPS-1, or -1 to stop. Held until changed or the turn ends.
 * - jump / backflip: one-shot, applied on the tick they're stamped for
 * - fire: one-shot; passed to the sim as CritterInput.fire. If the sim reports a "fired" event
 *   for the active critter, control ends and retreat starts. Unsupported weapons do nothing.
 * - trigger: one-shot; pops the active critter's triggerable shots in flight (also in retreat)
 * - skip: end the turn now
 */
export type Cmd =
  | { k: "move"; yaw: number }
  | { k: "jump" }
  | { k: "backflip" }
  | ({ k: "fire" } & FireCommand)
  | { k: "trigger" }
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
  "pinecone-popper",
  "hopper-ball",
  "firecracker-bundle",
  "soda-jetpack",
  "umbrella-glide",
  "build-block",
  "bubble-shield",
  "cookie-snack",
  "fizz-rocket",
  "paper-plane-seeker",
  "slingshot",
  "gumball-cluster",
  "snow-globe",
  "hot-sauce-flask",
  "glue-puddle",
  "feather-charm",
  "wind-up-robot",
  "marble-roller",
  "rc-racer",
  "kite-bomber",
  "pea-gatling",
  "water-pistol",
  "spatula-swat",
  "pillow-bash",
  "mousetrap-snapper",
  "lantern-drift",
  "toy-block-drop",
  "marble-meteor-shower",
  "party-pinata",
  "tabletop-quake",
] as const satisfies readonly WeaponId[];

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const MAX_CMDS_PER_INPUT = 16;
/** Largest grid edge, for validating target voxels. */
const MAX_COORD = 511;

function isTarget(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 3 &&
    isIntIn(o.x, 0, MAX_COORD) &&
    isIntIn(o.y, 0, MAX_COORD) &&
    isIntIn(o.z, 0, MAX_COORD)
  );
}

export function isCmd(v: unknown): v is Cmd {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  switch (o.k) {
    case "move":
      return keys.length === 2 && isIntIn(o.yaw, -1, YAW_STEPS - 1);
    case "jump":
    case "backflip":
    case "trigger":
    case "skip":
      return keys.length === 1;
    case "fire":
      return (
        keys.every((k) =>
          ["k", "weaponId", "yaw", "pitch", "power", "fuseSeconds", "target"].includes(k),
        ) &&
        (WEAPON_IDS as readonly unknown[]).includes(o.weaponId) &&
        isIntIn(o.yaw, 0, YAW_STEPS - 1) &&
        isIntIn(o.pitch, PITCH_MIN, PITCH_MAX) &&
        isIntIn(o.power, 0, 100) &&
        (o.fuseSeconds === undefined || isIntIn(o.fuseSeconds, 1, 5)) &&
        (o.target === undefined || isTarget(o.target))
      );
    default:
      return false;
  }
}

// ------------------------------------------------------------ config and state

export interface MatchConfig {
  /** Seeds the match rng (wind, later crates). The map has its own seed in `map`. */
  seed: number;
  /** Critters per team, one entry per team (2..8 teams). */
  teamSizes: number[];
  turnTicks: number;
  retreatTicks: number;
  settleCapTicks: number;
  startHealth: number;
  /** Wind strength range per turn (0 = off). */
  windMax: number;
  /** How the island is built. Every client regenerates it from this. */
  map: MapRecipe;
  /**
   * True for a practice match: one player against a team of target dummies nobody controls.
   * The rules are the same; clients use it to show the guided prompts.
   */
  practice?: boolean;
  /**
   * Practice only: the sim team index of the target dummies. One dummy starts at a spot near the
   * player so the first shots can land, and no crate drops as a dummy turn starts (those turns
   * are skipped at once, so they would double the drops the player sees).
   */
  dummyTeam?: number;
  /** Sudden death: from the round after this one the soda rises every turn. 0 or absent = off. */
  suddenDeathRound?: number;
  /**
   * Weather and time of day, already resolved (never "random"). Clients draw them; the sim only
   * reads `weather` for storm gusts. Absent means clear weather in the theme's own light.
   */
  sky?: { weather: string; time: string };
  /** Voxels the soda rises per turn once sudden death starts. Default 2. */
  seaRisePerTurn?: number;
}

export interface MatchState {
  sim: SimState;
  turns: TurnState;
  rng: PrngState;
  /** Active critter's held walk heading, -1 when standing. Reset on every new turn. */
  moveYaw: number;
  /**
   * Shots left per team, by weapon id, for weapons with limited ammo. A weapon that is not listed
   * is unlimited. A fire command for a weapon at 0 is dropped.
   */
  ammo: Record<string, number>[];
  /** Crates lying on the map (see crates.ts). */
  crates: Crate[];
}

/** The ammo every team starts a match with: the limited weapons from the catalogue. */
export function startingAmmo(): Record<string, number> {
  const out: Record<string, number> = {};
  // Crate-only weapons start empty; a weapon crate adds one.
  for (const w of weaponCatalog())
    if (w.fireable && w.ammo !== null) out[w.id] = w.crateOnly ? 0 : w.ammo;
  return out;
}

export interface StepOutput {
  state: MatchState;
  events: readonly SimEvent[];
  /** True when this step started a new turn (or ended the match). */
  turnChanged: boolean;
}

/**
 * The one turn controller every match uses (server, clients, hot-seat). There is deliberately no
 * way to pass a different one: two controllers would silently desync. Edit it in place.
 */
export const MATCH_TURNS = basicTurns;

export const TICKS_PER_SECOND = 60;
/** The server broadcasts a state hash on every tick divisible by this (protocol section 7). */
export const HASH_EVERY = 30;

/** Grid edge (X and Z) for a team count: bigger islands for bigger parties. */
export function mapSizeFor(teams: number): number {
  return teams <= 2 ? 192 : teams <= 4 ? 256 : teams <= 6 ? 320 : 384;
}

/**
 * The recipe for a match map. With `map`, a themed map (generator 3) of that theme and size, made
 * at least as big as the theme needs. Without it, the older unthemed island sized for `teams`.
 */
export function mapRecipeFor(
  seed: number,
  teams: number,
  map?: { theme: string; size: number },
): MapRecipe {
  if (map) {
    const theme = THEMES.find((t) => t.id === map.theme);
    if (!theme) throw new RangeError(`unknown map theme ${map.theme}`);
    const size = MAP_SIZES.find((s) => s >= Math.max(map.size, theme.minSize)) ?? map.size;
    return themedRecipe(theme.id, seed, size);
  }
  const theme = "picnic";
  const size = mapSizeFor(teams);
  return {
    generator: GENERATOR_VERSION,
    seed: seed >>> 0,
    sizeX: size,
    sizeY: 96,
    sizeZ: size,
    theme,
  };
}

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
  const map = generate(cfg.map);
  // Never stack critters on a fallback spot: a map too small for the match is a config error.
  if (map.spawns.length < total) {
    throw new RangeError(
      `map ${cfg.map.sizeX}x${cfg.map.sizeZ} has room for ${map.spawns.length} critters, need ${total}`,
    );
  }
  const critters: Critter[] = [];
  let id = 1;
  let spawnIndex = 0;
  // Interleave teams so nobody gets all the high ground.
  const maxSize = Math.max(...cfg.teamSizes);
  for (let i = 0; i < maxSize; i++) {
    for (let team = 0; team < cfg.teamSizes.length; team++) {
      if (i >= (cfg.teamSizes[team] ?? 0)) continue;
      const sp = map.spawns[spawnIndex++]!;
      // Spawns are grounded by contract, so critters start standing rather than "landing".
      critters.push({
        ...createCritter(id++, team, sp.x, sp.y, sp.z, cfg.startHealth),
        grounded: true,
      });
    }
  }
  if (cfg.dummyTeam !== undefined)
    moveDummyNear(critters, cfg.dummyTeam, map.spawns.slice(spawnIndex));
  const sim = createWorld(map.terrain, critters);
  const first = turns.init(sim, rulesFor(cfg), 0, rng);
  return {
    sim: { ...sim, windX: first.windX, windZ: first.windZ },
    turns: first,
    rng: rng.getState(),
    moveYaw: -1,
    ammo: cfg.teamSizes.map(() => startingAmmo()),
    crates: [],
  };
}

/** Practice: a dummy this far from the player (voxels, flat) is easy to reach with a first shot. */
export const PRACTICE_NEAR_MIN = 25;
export const PRACTICE_NEAR_MAX = 70;
const PRACTICE_NEAR_IDEAL = 45;

/**
 * Move the first target dummy to the unused spawn closest to PRACTICE_NEAR_IDEAL voxels from the
 * player's first critter, if one lies in [PRACTICE_NEAR_MIN, PRACTICE_NEAR_MAX]. Otherwise leave
 * the spawns as they are. Deterministic: same config, same spots.
 */
function moveDummyNear(
  critters: Critter[],
  dummyTeam: number,
  free: readonly { x: number; y: number; z: number }[],
): void {
  const player = critters.find((c) => c.team !== dummyTeam);
  const dummy = critters.findIndex((c) => c.team === dummyTeam);
  if (!player || dummy < 0) return;
  const px = Math.floor(player.pos.x / FIXED_ONE);
  const pz = Math.floor(player.pos.z / FIXED_ONE);
  let best: { x: number; y: number; z: number } | undefined;
  let bestScore = Infinity;
  for (const sp of free) {
    // Squared whole-voxel distances: integer maths only, so every machine picks the same spot.
    const d2 = (sp.x - px) ** 2 + (sp.z - pz) ** 2;
    if (d2 < PRACTICE_NEAR_MIN ** 2 || d2 > PRACTICE_NEAR_MAX ** 2) continue;
    const score = Math.abs(d2 - PRACTICE_NEAR_IDEAL ** 2);
    if (score < bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  if (!best) return;
  const old = critters[dummy]!;
  critters[dummy] = {
    ...createCritter(old.id, old.team, best.x, best.y, best.z, old.hp),
    grounded: true,
  };
}

/** The sim input for this tick's active critter, from the held heading + one-shots. */
function inputFor(critterId: number, moveYaw: number, cmds: readonly Cmd[]): CritterInput {
  let jump = false;
  let backflip = false;
  let trigger = false;
  let fire: FireCommand | undefined;
  for (const c of cmds) {
    if (c.k === "jump") jump = true;
    if (c.k === "backflip") backflip = true;
    if (c.k === "trigger") trigger = true;
    if (c.k === "fire" && !fire) {
      fire = {
        weaponId: c.weaponId,
        yaw: c.yaw,
        pitch: c.pitch,
        power: c.power,
        ...(c.fuseSeconds === undefined ? {} : { fuseSeconds: c.fuseSeconds }),
        ...(c.target === undefined ? {} : { target: c.target }),
      };
    }
  }
  const input: CritterInput = fire
    ? { critterId, moveYaw, jump, backflip, fire }
    : { critterId, moveYaw, jump, backflip };
  // Only set when sent, so inputs (and hashes) without a trigger are unchanged.
  return trigger ? { ...input, trigger } : input;
}

/**
 * Advance one tick with the commands stamped for it. Commands are ignored unless someone has
 * control, so stale or late commands can't desync. Mutates only the terrain (in place, as
 * stepWorld does); everything else is returned as new state.
 */
export function stepMatch(cfg: MatchConfig, state: MatchState, cmds: readonly Cmd[]): StepOutput {
  const turns = MATCH_TURNS;
  const rules = rulesFor(cfg);
  const tick = state.sim.tick + 1;
  let ts = state.turns;
  let moveYaw = state.moveYaw;
  const controlling = turns.activeTeam(ts) !== null && ts.activeCritter !== null;

  // A frozen critter's turn is skipped as it starts, which thaws it (Snow Globe).
  const thawed: SimEvent[] = [];
  let simIn = state.sim;
  const ice =
    controlling && ts.phase === "control"
      ? simIn.critters.find((c) => c.id === ts.activeCritter && c.frozen)
      : undefined;
  if (ice) {
    thawed.push({ type: "thawed", critterId: ice.id });
    simIn = {
      ...simIn,
      critters: simIn.critters.map((c) => {
        if (c.id !== ice.id) return c;
        const { frozen: _f, ...rest } = c;
        void _f;
        return rest;
      }),
    };
    ts = turns.endTurn(ts, rules, "skip", tick);
  }

  const inputs: CritterInput[] = [];
  if (controlling && !ice) {
    for (const c of cmds) if (c.k === "move") moveYaw = c.yaw;
    inputs.push(inputFor(ts.activeCritter!, moveYaw, cmds));
    if (cmds.some((c) => c.k === "skip")) ts = turns.endTurn(ts, rules, "skip", tick);
  }
  // Only one shot per turn: no firing during retreat.
  if (ts.phase === "retreat" && inputs[0]?.fire) {
    const { fire: _drop, ...rest } = inputs[0];
    void _drop;
    inputs[0] = rest;
  }
  if (turns.activeTeam(ts) === null) {
    inputs.length = 0;
    moveYaw = -1;
  }
  // Out of ammo: the shot is dropped and the turn goes on.
  const shooter = turns.activeTeam(ts);
  const wanted = inputs[0]?.fire?.weaponId;
  if (shooter !== null && wanted !== undefined && state.ammo[shooter]?.[wanted] === 0) {
    const { fire: _empty, ...rest } = inputs[0]!;
    void _empty;
    inputs[0] = rest;
  }

  const rng = Prng.fromState(state.rng);
  // The turn controller owns wind; the sim reads it from SimState.
  const sim: SimState = { ...simIn, windX: ts.windX, windZ: ts.windZ };
  const r = stepWorld(sim, inputs, rng);
  let ammo = state.ammo;
  for (const e of r.events) {
    if (e.type !== "fired" || e.critterId !== ts.activeCritter) continue;
    const left = shooter === null ? undefined : ammo[shooter]?.[e.weaponId];
    if (left !== undefined)
      ammo = ammo.map((a, i) =>
        i === shooter ? { ...a, [e.weaponId]: Math.max(0, left - 1) } : a,
      );
    // Utilities like the Drill Hat leave the turn running.
    if (loadWeapons()[e.weaponId].endsTurn) ts = turns.endTurn(ts, rules, "fired", tick);
  }
  const next = turns.update(ts, rules, r.state, r.events, r.state.tick, rng);
  const turnChanged =
    next.turn !== state.turns.turn || (next.phase === "over") !== (state.turns.phase === "over");
  let simOut: SimState = { ...r.state, windX: next.windX, windZ: next.windZ };
  // Sudden death: once the round limit passes, the soda rises at the start of every turn.
  const sdRound = cfg.suddenDeathRound ?? 0;
  if (turnChanged && next.phase !== "over" && sdRound > 0 && next.round > sdRound) {
    const top = simOut.terrain.sizeY;
    simOut = { ...simOut, seaY: Math.min(top, simOut.seaY + (cfg.seaRisePerTurn ?? 2)) };
  }
  // Crates: fall with the ground, get taken by whoever walks into them, and a new one may drop
  // as each turn starts.
  const events: SimEvent[] = [...thawed, ...r.events];
  // Fire puddles scorch, puddles dry, Feather Charms wear off.
  if (turnChanged && next.phase !== "over") simOut = zonesTurnEnd(simOut, events);
  const settled = settleCrates(simOut.terrain, simOut.seaY, state.crates);
  for (const c of settled.lost) events.push({ type: "crateLost", crateId: c.id });
  const got = collectCrates(settled.crates, simOut.critters);
  let crates = got.crates;
  for (const { crate, critterId } of got.taken) {
    const who = simOut.critters.find((c) => c.id === critterId)!;
    let amount = 1;
    if (crate.kind === "health") {
      amount = Math.min(CRATE_HEAL, Math.max(0, MAX_HEALTH - who.hp));
      simOut = {
        ...simOut,
        critters: simOut.critters.map((c) =>
          c.id === critterId ? { ...c, hp: c.hp + amount } : c,
        ),
      };
    } else {
      const left = ammo[who.team]?.[crate.weaponId];
      if (left !== undefined)
        ammo = ammo.map((a, i) => (i === who.team ? { ...a, [crate.weaponId]: left + 1 } : a));
    }
    events.push({
      type: "crateTaken",
      crateId: crate.id,
      critterId,
      kind: crate.kind,
      weaponId: crate.weaponId,
      amount,
    });
  }
  if (
    turnChanged &&
    next.phase !== "over" &&
    (cfg.dummyTeam === undefined || next.activeTeam !== cfg.dummyTeam) &&
    crates.length < MAX_CRATES &&
    rng.chance(CRATE_CHANCE_NUM, CRATE_CHANCE_DEN)
  ) {
    const fresh = dropCrate(
      simOut.terrain,
      simOut.seaY,
      rng,
      next.turn,
      Object.keys(startingAmmo()),
    );
    if (fresh) {
      crates = [...crates, fresh];
      events.push({
        type: "crateDropped",
        crateId: fresh.id,
        kind: fresh.kind,
        x: fresh.x,
        y: fresh.y,
        z: fresh.z,
      });
    }
  }
  return {
    state: {
      sim: simOut,
      turns: next,
      rng: rng.getState(),
      moveYaw: turnChanged ? -1 : moveYaw,
      ammo,
      crates,
    },
    events,
    turnChanged,
  };
}

// ------------------------------------------------------------ hashing

/** u32 hash of the full match state (protocol section 7). */
export function hashMatch(state: MatchState): number {
  const h = new StateHasher();
  // Every sim field except the terrain goes through the canonical hasher, so fields added later
  // are covered automatically. The terrain hash is cached per chunk inside terrain3d.
  const { terrain, ...rest } = state.sim;
  h.i32(hashTerrain(terrain) | 0).value(rest);
  h.value(state.turns);
  for (const w of state.rng) h.i32(w);
  h.i32(state.moveYaw);
  h.value(state.ammo);
  h.value(state.crates);
  return h.digest();
}

// ------------------------------------------------------------ snapshots

/**
 * JSON-safe full state, as sent in `snapshot` and `match.start`. The terrain travels as its edit
 * log: the receiver regenerates the island from the config's map recipe and replays the edits.
 */
export interface MatchSnapshot {
  /** Every SimState field except terrain. */
  sim: Omit<SimState, "terrain">;
  /** Every terrain edit since generation, in order. */
  edits: TerrainEdit[];
  turns: TurnState;
  rng: [number, number, number, number];
  moveYaw: number;
  /** Absent in snapshots from before ammo existed: those load with full ammo. */
  ammo?: Record<string, number>[];
  /** Absent in snapshots from before crates existed. */
  crates?: Crate[];
}

export function saveMatch(state: MatchState): MatchSnapshot {
  const { terrain, ...rest } = state.sim;
  return {
    sim: structuredClone(rest),
    edits: structuredClone(terrain.edits),
    turns: structuredClone(state.turns),
    rng: [...state.rng] as [number, number, number, number],
    moveYaw: state.moveYaw,
    ammo: structuredClone(state.ammo),
    crates: structuredClone(state.crates),
  };
}

export function loadMatch(cfg: MatchConfig, snap: MatchSnapshot): MatchState {
  const terrain = restore(cfg.map, snap.edits);
  const sim: SimState = { ...structuredClone(snap.sim), terrain };
  return {
    sim,
    turns: structuredClone(snap.turns),
    rng: Prng.fromState(snap.rng).getState(),
    moveYaw: snap.moveYaw,
    ammo: snap.ammo ? structuredClone(snap.ammo) : cfg.teamSizes.map(() => startingAmmo()),
    crates: snap.crates ? structuredClone(snap.crates) : [],
  };
}
