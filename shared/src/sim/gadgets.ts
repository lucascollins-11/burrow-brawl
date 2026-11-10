// Rope Claw, Drill Hat, Boulder of Doom and supply crates. Everything here is integer or Q16.16
// math (no floats, no Math.random), stepped from stepWorld in a fixed order so results are
// identical on every platform. Terrain is carved in place, like explosions.

import type { Fixed } from "../fixed";
import { cosDeg, FIXED_ONE, idiv, isqrt, sinDeg, toFixed } from "../fixed";
import { carveCircle, isSolid } from "../terrain";
import type { Terrain } from "../terrain";
import { loadWeapons } from "../weapons/load";
import type { WeaponId } from "../weapons/load";
import {
  CRITTER_HALF_WIDTH,
  CRITTER_HEIGHT,
  MAX_HEALTH,
  TERMINAL_VELOCITY,
  TICK_RATE,
} from "./constants";
import { bodyBlocked } from "./step";
import type {
  Boulder,
  Crate,
  Critter,
  CritterInput,
  Drill,
  FireCommand,
  Inventory,
  Rng,
  Rope,
  SimEvent,
  SimState,
} from "./types";

const cell = (f: Fixed): number => f >> 16;

/** Body centre sits this many cells above the feet. */
const CENTER = CRITTER_HEIGHT >> 1;

// ------------------------------------------------------------ tuning (fixed-point per tick)

/** Rope: hook flies this many cells per tick (claimSpeed 1200 units/s). */
const HOOK_STEPS_PER_TICK = 20;
const ROPE_MAX = 300;
const ROPE_MIN = 30;
const PENDULUM_GRAVITY: Fixed = Math.round((600 * FIXED_ONE) / (TICK_RATE * TICK_RATE)) | 0;
const SWING_PUSH: Fixed = toFixed(0.025);
const SWING_MAX_SPEED: Fixed = toFixed(9);
/** The rope reels in this much per tick until it is REEL_MIN long, so a grounded critter is pulled up. */
const REEL_SPEED = toFixed(0.7);
const REEL_MIN = 60 * FIXED_ONE;

/** Drill: 1 cell per tick (60 cells/s), tunnel radius 14, 3 s. */
const DRILL_RADIUS = 14;
const DRILL_TICKS = 3 * TICK_RATE;
const BEDROCK = 255;

/** Boulder: 90 cells/s, radius 20, embedded 6 cells so it rides the ground. */
const BOULDER_SPEED: Fixed = Math.round((90 * FIXED_ONE) / TICK_RATE) | 0;
const BOULDER_RADIUS = 20;
const BOULDER_EMBED = 6;
const BOULDER_MAX_TICKS = 12 * TICK_RATE;
const BOULDER_CLIMB = 3;
const BOULDER_FALL = 4;
const BOULDER_KNOCK_X: Fixed = toFixed(4);
const BOULDER_KNOCK_Y: Fixed = toFixed(-4);

/** Crates: fall slowly, 8x8 cells. */
const CRATE_HALF = 4;
const CRATE_FALL_SPEED: Fixed = toFixed(1.5);
const CRATE_HEALTH = 25;
const CRATE_MAX_ALIVE = 3;
/** Percent chance that a crate drops at the start of a turn. */
const CRATE_DROP_PERCENT = 35;
export const CRATE_WEAPONS = [
  "boulder-of-doom",
  "drill-hat",
] as const satisfies readonly WeaponId[];

export function isGadgetWeapon(id: string): id is "rope-claw" | "drill-hat" | "boulder-of-doom" {
  return id === "rope-claw" || id === "drill-hat" || id === "boulder-of-doom";
}

function replaceAt<T>(list: readonly T[], i: number, item: T): T[] {
  const out = list.slice();
  out[i] = item;
  return out;
}

function withInput(inputs: readonly CritterInput[], id: number): CritterInput | undefined {
  for (const i of inputs) if (i.critterId === id) return i;
  return undefined;
}

export interface GadgetState {
  critters: Critter[];
  ropes: Rope[];
  drills: Drill[];
  boulders: Boulder[];
  crates: Crate[];
  inventory: Inventory[];
  nextEntityId: number;
}

/** Spend one use of a limited weapon. Returns the new inventory, or null if none are left. */
function spend(inv: readonly Inventory[], team: number, weaponId: string): Inventory[] | null {
  const have = inv[team]?.[weaponId] ?? 0;
  if (have <= 0) return null;
  return replaceAt(inv, team, { ...inv[team], [weaponId]: have - 1 });
}

/** Does this weapon end the turn once used? Data-driven (endsTurn). */
export function endsTurn(weaponId: WeaponId): boolean {
  return loadWeapons()[weaponId].endsTurn;
}

// ------------------------------------------------------------ firing

/** Start a gadget for a fire command. Returns null if the weapon is not one of ours or has no uses left. */
export function gadgetsOnFire(
  t: Terrain,
  g: GadgetState,
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): { critter: Critter } | null {
  if (!isGadgetWeapon(cmd.weaponId)) return null;
  const cos = cosDeg(cmd.angleDeg);
  const sin = sinDeg(cmd.angleDeg);
  const facing: -1 | 1 = cos < 0 ? -1 : 1;

  if (cmd.weaponId === "rope-claw") {
    const rope: Rope = {
      critterId: c.id,
      phase: "flying",
      x: c.x,
      y: (c.y - CENTER * FIXED_ONE) | 0,
      dx: cos,
      dy: -sin | 0,
      travelled: 0,
      length: 0,
    };
    g.ropes = [...g.ropes.filter((r) => r.critterId !== c.id), rope];
    events.push({ type: "gadget", critterId: c.id, weaponId: "rope-claw", phase: "fired" });
    // Utilities don't end the turn: only the "fired" event does that, and the rope's endsTurn is false.
    if (endsTurn("rope-claw")) {
      events.push({ type: "fired", critterId: c.id, projectileId: 0, weaponId: "rope-claw" });
    }
    return { critter: { ...c, facing } };
  }

  const left = spend(g.inventory, c.team, cmd.weaponId);
  if (!left) return null;

  if (cmd.weaponId === "drill-hat") {
    // Aiming below the horizon digs down; otherwise sideways the way the critter faces.
    const mode = sin < 0 ? "down" : "side";
    g.inventory = left;
    g.drills = [
      ...g.drills.filter((d) => d.critterId !== c.id),
      { critterId: c.id, ticksLeft: DRILL_TICKS, mode },
    ];
    events.push({ type: "gadget", critterId: c.id, weaponId: "drill-hat", phase: "fired" });
    if (endsTurn("drill-hat")) {
      events.push({ type: "fired", critterId: c.id, projectileId: 0, weaponId: "drill-hat" });
    }
    return { critter: { ...c, facing } };
  }

  // Boulder of Doom: starts beside the critter and rolls the way it faces.
  g.inventory = left;
  const id = g.nextEntityId++;
  const x = (c.x + facing * 24 * FIXED_ONE) | 0;
  const gs = groundBelow(t, cell(x), cell(c.y) - BOULDER_RADIUS * 2);
  g.boulders = [
    ...g.boulders,
    {
      id,
      ownerId: c.id,
      x,
      y: toFixed(gs - BOULDER_RADIUS + BOULDER_EMBED),
      dir: facing,
      age: 0,
      hit: [],
    },
  ];
  if (endsTurn("boulder-of-doom")) {
    events.push({ type: "fired", critterId: c.id, projectileId: 0, weaponId: "boulder-of-doom" });
  }
  return { critter: { ...c, facing } };
}

/** First solid row at or below `fromY` in column x, or the map bottom if there is none. */
function groundBelow(t: Terrain, x: number, fromY: number): number {
  const start = Math.max(0, fromY);
  for (let y = start; y < t.height; y++) if (isSolid(t, x, y)) return y;
  return t.height;
}

// ------------------------------------------------------------ rope

function stepRopes(
  t: Terrain,
  g: GadgetState,
  prev: readonly Critter[],
  inputs: readonly CritterInput[],
  events: SimEvent[],
): void {
  const next: Rope[] = [];
  for (const r of g.ropes) {
    const ci = g.critters.findIndex((c) => c.id === r.critterId);
    const cur = g.critters[ci];
    if (!cur || cur.status !== "alive") continue;

    if (r.phase === "flying") {
      let { x, y, travelled } = r;
      let anchored = false;
      let lost = false;
      for (let i = 0; i < HOOK_STEPS_PER_TICK; i++) {
        x = (x + r.dx) | 0;
        y = (y + r.dy) | 0;
        travelled++;
        if (isSolid(t, cell(x), cell(y))) {
          anchored = true;
          break;
        }
        if (travelled >= ROPE_MAX) {
          lost = true;
          break;
        }
      }
      if (lost) {
        events.push({
          type: "gadget",
          critterId: cur.id,
          weaponId: "rope-claw",
          phase: "released",
        });
        continue;
      }
      if (!anchored) {
        next.push({ ...r, x, y, travelled });
        continue;
      }
      const rx = x - cur.x;
      const ry = y - ((cur.y - CENTER * FIXED_ONE) | 0);
      const dist = isqrt(rx * rx + ry * ry);
      const length = Math.max(ROPE_MIN * FIXED_ONE, Math.min(ROPE_MAX * FIXED_ONE, dist));
      next.push({ ...r, phase: "attached", x, y, length });
      events.push({ type: "gadget", critterId: cur.id, weaponId: "rope-claw", phase: "attached" });
      continue;
    }

    // Attached: swing on the rope, replacing the critter's normal movement this tick.
    const before = prev.find((c) => c.id === r.critterId) ?? cur;
    const input = withInput(inputs, r.critterId);
    // Jump or backflip lets go, keeping the swing's speed.
    const anchorSolid = isSolid(t, cell(r.x), cell(r.y));
    if (input?.jump || input?.backflip || !anchorSolid) {
      g.critters[ci] = { ...before, grounded: false, peakY: cell(before.y) };
      events.push({ type: "gadget", critterId: cur.id, weaponId: "rope-claw", phase: "released" });
      continue;
    }

    const length = r.length > REEL_MIN ? Math.max(REEL_MIN, r.length - REEL_SPEED) : r.length;
    const rope = length === r.length ? r : { ...r, length };
    let vx = before.vx;
    let vy = before.vy;
    const move = input?.move ?? 0;
    vx = (vx + move * SWING_PUSH) | 0;
    vy = (vy + PENDULUM_GRAVITY) | 0;
    vx = (vx - (vx >> 8)) | 0; // a little air drag
    vy = (vy - (vy >> 8)) | 0;
    vx = Math.max(-SWING_MAX_SPEED, Math.min(SWING_MAX_SPEED, vx));
    vy = Math.max(-SWING_MAX_SPEED, Math.min(SWING_MAX_SPEED, vy));

    let x = (before.x + vx) | 0;
    let y = (before.y + vy) | 0;
    // Keep the body centre within the rope's length of the anchor.
    let rx = x - r.x;
    let ry = y - CENTER * FIXED_ONE - r.y;
    const dist = isqrt(rx * rx + ry * ry);
    if (dist > length) {
      rx = idiv(rx * length, dist);
      ry = idiv(ry * length, dist);
      x = (r.x + rx) | 0;
      y = (r.y + ry + CENTER * FIXED_ONE) | 0;
      // Drop the outward part of the velocity.
      const radial = idiv(vx * rx + vy * ry, length);
      if (radial > 0) {
        vx = (vx - idiv(radial * rx, length)) | 0;
        vy = (vy - idiv(radial * ry, length)) | 0;
      }
    }
    let grounded = false;
    if (bodyBlocked(t, cell(x), cell(y))) {
      // Bumped into the terrain: stop there instead of passing through it.
      x = before.x;
      y = before.y;
      vx = 0;
      vy = 0;
      grounded = isSolid(t, cell(x), cell(y) + 1);
    }
    g.critters[ci] = {
      ...before,
      x,
      y,
      vx,
      vy,
      grounded,
      peakY: cell(y), // swinging never counts as a fall
      facing: vx < 0 ? -1 : vx > 0 ? 1 : before.facing,
    };
    next.push(rope);
  }
  g.ropes = next;
}

// ------------------------------------------------------------ drill

function stepDrills(t: Terrain, g: GadgetState, events: SimEvent[]): void {
  const next: Drill[] = [];
  for (const d of g.drills) {
    const ci = g.critters.findIndex((c) => c.id === d.critterId);
    const c = g.critters[ci];
    if (!c || c.status !== "alive") continue;
    const cx = cell(c.x);
    const cy = cell(c.y);
    let nx = cx;
    let ny = cy;
    let stop = false;
    if (d.mode === "down") {
      ny = cy + 1;
      // Bedrock below ends the tunnel.
      if (t.cells[(ny + 1) * t.width + cx] === BEDROCK && ny + 1 < t.height) stop = true;
    } else {
      nx = cx + c.facing;
      if (t.cells[(cy - CENTER) * t.width + nx + c.facing * DRILL_RADIUS] === BEDROCK) stop = true;
    }
    if (!stop) {
      carveCircle(t, nx, ny - CENTER, DRILL_RADIUS);
      g.critters[ci] = {
        ...c,
        x: toFixed(nx),
        y: toFixed(ny),
        vx: 0,
        vy: 0,
        grounded: false,
        peakY: ny, // digging never counts as a fall
      };
    }
    const left = d.ticksLeft - 1;
    if (left <= 0 || stop) {
      events.push({ type: "gadget", critterId: c.id, weaponId: "drill-hat", phase: "ended" });
    } else {
      next.push({ ...d, ticksLeft: left });
    }
  }
  g.drills = next;
}

// ------------------------------------------------------------ boulder

function stepBoulders(t: Terrain, g: GadgetState, events: SimEvent[]): void {
  const w = loadWeapons()["boulder-of-doom"];
  const radius = Math.max(1, Math.trunc(w.blastRadius) || BOULDER_RADIUS);
  const carveR = Math.max(1, radius - BOULDER_EMBED);
  const next: Boulder[] = [];
  for (const b of g.boulders) {
    const x = (b.x + b.dir * BOULDER_SPEED) | 0;
    const cx = cell(x);
    const cy = cell(b.y);
    const age = b.age + 1;
    if (age > BOULDER_MAX_TICKS || cx < -radius || cx > t.width + radius) continue;
    // Bedrock in the way stops it.
    const aheadX = cx + b.dir * radius;
    if (aheadX >= 0 && aheadX < t.width && cy >= 0 && cy < t.height) {
      if (t.cells[cy * t.width + aheadX] === BEDROCK) continue;
    }

    // Ride the ground: its height here, found before carving, so the boulder doesn't sink.
    const gs = groundBelow(t, Math.max(0, Math.min(t.width - 1, cx)), cy - radius * 2);
    const target = gs - radius + BOULDER_EMBED;
    const ny = Math.max(cy - BOULDER_CLIMB, Math.min(cy + BOULDER_FALL, target));
    carveCircle(t, cx, ny, carveR);

    // Crush: each critter in reach is hit once, damaged and thrown ahead and up.
    const hit = b.hit.slice();
    g.critters = g.critters.map((c) => {
      if (c.status !== "alive" || hit.includes(c.id)) return c;
      const dx = cell(c.x) - cx;
      const dy = cell(c.y) - CENTER - ny;
      if (isqrt(dx * dx + dy * dy) > radius + CRITTER_HALF_WIDTH) return c;
      hit.push(c.id);
      const dealt = Math.min(c.hp, Math.max(0, Math.trunc(w.damage)));
      const hp = c.hp - dealt;
      events.push({ type: "damage", critterId: c.id, amount: dealt, cause: "explosion" });
      let status: Critter["status"] = c.status;
      if (hp <= 0) {
        status = "dead";
        events.push({ type: "died", critterId: c.id, cause: "explosion" });
      }
      const clamp = (v: Fixed): Fixed =>
        Math.max(-TERMINAL_VELOCITY * 2, Math.min(TERMINAL_VELOCITY * 2, v)) | 0;
      return {
        ...c,
        hp,
        status,
        vx: clamp((c.vx + b.dir * BOULDER_KNOCK_X) | 0),
        vy: clamp((c.vy + BOULDER_KNOCK_Y) | 0),
        grounded: false,
        peakY: cell(c.y),
      };
    });
    next.push({ ...b, x, y: toFixed(ny), age, hit });
  }
  g.boulders = next;
}

// ------------------------------------------------------------ crates

/**
 * Maybe drop a crate at the top of the map. Called when a turn starts, with the match rng, so
 * every client rolls the same crate. Returns the sim unchanged when nothing drops.
 */
export function maybeDropCrate(sim: SimState, rng: Rng): { sim: SimState; events: SimEvent[] } {
  if (sim.crates.length >= CRATE_MAX_ALIVE) return { sim, events: [] };
  if (rng.nextInt(100) >= CRATE_DROP_PERCENT) return { sim, events: [] };
  const margin = 40;
  const x = margin + rng.nextInt(Math.max(1, sim.terrain.width - 2 * margin));
  const kind = rng.nextInt(2) === 0 ? "health" : "weapon";
  const weaponId =
    kind === "weapon" ? (CRATE_WEAPONS[rng.nextInt(CRATE_WEAPONS.length)] ?? null) : null;
  const crate: Crate = {
    id: sim.nextEntityId,
    x,
    y: toFixed(-CRATE_HALF),
    vy: 0,
    kind,
    weaponId,
    grounded: false,
  };
  return {
    sim: { ...sim, crates: [...sim.crates, crate], nextEntityId: sim.nextEntityId + 1 },
    events: [{ type: "crateDropped", crateId: crate.id, x, kind }],
  };
}

function stepCrates(t: Terrain, g: GadgetState, events: SimEvent[]): void {
  const next: Crate[] = [];
  for (const cr of g.crates) {
    let { y, vy, grounded } = cr;
    if (!grounded) {
      vy = Math.min(CRATE_FALL_SPEED, (vy + toFixed(0.05)) | 0);
      const ny = (y + vy) | 0;
      // Land when the cell under the crate's base is solid (checked along its width).
      const base = cell(ny) + CRATE_HALF;
      let hit = false;
      for (let dx = -CRATE_HALF; dx <= CRATE_HALF && !hit; dx++) hit = isSolid(t, cr.x + dx, base);
      if (hit) {
        grounded = true;
        vy = 0;
      } else {
        y = ny;
      }
    } else {
      // Terrain carved from under a resting crate lets it fall again.
      const base = cell(y) + CRATE_HALF + 1;
      let support = false;
      for (let dx = -CRATE_HALF; dx <= CRATE_HALF && !support; dx++) {
        support = isSolid(t, cr.x + dx, base);
      }
      if (!support) grounded = false;
    }

    // Collected by the first living critter (in array order) whose body touches the crate.
    let taker = -1;
    for (let i = 0; i < g.critters.length && taker < 0; i++) {
      const c = g.critters[i]!;
      if (c.status !== "alive") continue;
      const dx = Math.abs(cell(c.x) - cr.x);
      const top = cell(c.y) - CRITTER_HEIGHT;
      const bottom = cell(c.y);
      const cyc = cell(y);
      if (
        dx <= CRITTER_HALF_WIDTH + CRATE_HALF &&
        cyc + CRATE_HALF >= top &&
        cyc - CRATE_HALF <= bottom
      ) {
        taker = i;
      }
    }
    if (taker >= 0) {
      const c = g.critters[taker]!;
      let amount = 0;
      if (cr.kind === "health") {
        const hp = Math.min(MAX_HEALTH, c.hp + CRATE_HEALTH);
        amount = hp - c.hp;
        g.critters[taker] = { ...c, hp };
      } else if (cr.weaponId) {
        const have = g.inventory[c.team]?.[cr.weaponId] ?? 0;
        g.inventory = replaceAt(g.inventory, c.team, {
          ...g.inventory[c.team],
          [cr.weaponId]: have + 1,
        });
      }
      events.push({
        type: "crateCollected",
        crateId: cr.id,
        critterId: c.id,
        kind: cr.kind,
        weaponId: cr.weaponId,
        amount,
      });
      continue;
    }
    // Lost in the soda: drop it once it is well below the map.
    if (cell(y) > t.height + 50) continue;
    next.push({ ...cr, y, vy, grounded });
  }
  g.crates = next;
}

// ------------------------------------------------------------ driver

/** Step ropes, drills, boulders and crates for one tick (after critters moved and fire was handled). */
export function stepGadgets(
  t: Terrain,
  g: GadgetState,
  prev: readonly Critter[],
  inputs: readonly CritterInput[],
  events: SimEvent[],
): void {
  stepRopes(t, g, prev, inputs, events);
  stepDrills(t, g, events);
  stepBoulders(t, g, events);
  stepCrates(t, g, events);
}

/** True while any gadget keeps the world busy (the turn must wait for it). */
export function gadgetsBusy(sim: SimState): boolean {
  return sim.boulders.length > 0 || sim.drills.length > 0 || sim.crates.some((c) => !c.grounded);
}

/** Let go of every rope (used when a turn ends). */
export function releaseRopes(sim: SimState): SimState {
  if (sim.ropes.length === 0) return sim;
  return {
    ...sim,
    ropes: [],
    critters: sim.critters.map((c) =>
      sim.ropes.some((r) => r.critterId === c.id) ? { ...c, grounded: false, peakY: cell(c.y) } : c,
    ),
  };
}
