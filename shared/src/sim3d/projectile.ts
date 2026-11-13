// Projectiles are points marched through the voxels in substeps of at most one voxel per axis.
// Impact weapons detonate in the last empty voxel before solid terrain or on a critter; bouncing
// weapons reflect off the integer density gradient and lose energy until their fuse runs out.
// Cluster weapons burst into sub-munitions (on impact, or mid-air on the owner's trigger), and
// strikes drop several bombs from above a target voxel.

import type { Fixed } from "../fixed";
import { FIXED_ONE, idiv } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import type { WeaponId } from "../weapons/load";
import type { Critter, FireCommand, Projectile, SimEvent, Zone } from "./api";
import { CRITTER_HEIGHT, PITCH_MAX, PITCH_MIN, YAW_STEPS } from "./api";
import {
  LENGTH_DEN,
  LENGTH_NUM,
  LOST_ALTITUDE,
  LOST_MARGIN,
  MAX_HEALTH,
  MAX_PROJECTILE_AGE_TICKS,
  MUZZLE_HEIGHT,
  MUZZLE_REACH,
  OWNER_GRACE_TICKS,
  REST_SPEED,
  TERMINAL_VELOCITY,
  TICK_RATE,
  WIND_ACCEL_PER_UNIT,
} from "./constants";
import { bodyBlocked, cell } from "./critter";
import { TRIGGERED_WEAPONS } from "../weapons/catalog";
import { steerStep, type SteerFlight } from "./steer";
import { isGearWeapon, speedPerTick, startGear, wearingGear } from "./gear";
import { dropShield, fireUtility, isUtilityWeapon, popShield } from "./utility";
import { zoneFrom } from "./zones";
import { applyEdit, isSolid, normalAt } from "./terrainOps";
import {
  aimDir,
  cosYaw,
  dot,
  length,
  mulDiv,
  mulQ,
  reflect,
  sinYaw,
  withLength,
  yawDir,
} from "./vec3";

/**
 * How a shot flies: "impact" detonates on terrain or a critter, "bounce" waits for its fuse,
 * "stick" clings to the first thing it touches and then lights its `stickFuseSeconds` fuse,
 * "roll" slides along the ground under gravity until its fuse; "walk", "drive" and "kite" are
 * moved by steer.ts.
 */
type Flight = "impact" | "bounce" | "stick" | "roll" | SteerFlight;

/** Every weapon that exists as a projectile in flight, sub-munitions included. */
const FLIGHT: Partial<Record<WeaponId, Flight>> = {
  "acorn-mortar": "impact",
  "pinecone-popper": "impact",
  "pinecone-seed": "impact",
  "beehive-bomb": "impact",
  "fizz-grenade": "bounce",
  "hopper-ball": "bounce",
  "firecracker-bundle": "bounce",
  "jelly-mine": "bounce",
  "fizz-rocket": "impact",
  "paper-plane-seeker": "impact",
  slingshot: "impact",
  "gumball-cluster": "bounce",
  gumball: "stick",
  "snow-globe": "bounce",
  "hot-sauce-flask": "impact",
  "glue-puddle": "impact",
  "wind-up-robot": "walk",
  "marble-roller": "roll",
  "rc-racer": "drive",
  "kite-bomber": "kite",
  "kite-charge": "impact",
};

/** The weapons a fire command can launch as projectiles (strikes drop bombs instead of one shot). */
export type ProjectileWeaponId =
  | "acorn-mortar"
  | "fizz-grenade"
  | "pinecone-popper"
  | "hopper-ball"
  | "beehive-strike"
  | "firecracker-bundle"
  | "jelly-mine"
  | "fizz-rocket"
  | "paper-plane-seeker"
  | "slingshot"
  | "gumball-cluster"
  | "snow-globe"
  | "hot-sauce-flask"
  | "glue-puddle"
  | "wind-up-robot"
  | "marble-roller"
  | "rc-racer"
  | "kite-bomber";

const FIREABLE: readonly string[] = [
  "acorn-mortar",
  "fizz-grenade",
  "pinecone-popper",
  "hopper-ball",
  "beehive-strike",
  "firecracker-bundle",
  "jelly-mine",
  "fizz-rocket",
  "paper-plane-seeker",
  "slingshot",
  "gumball-cluster",
  "snow-globe",
  "hot-sauce-flask",
  "glue-puddle",
  "wind-up-robot",
  "marble-roller",
  "rc-racer",
  "kite-bomber",
] satisfies readonly ProjectileWeaponId[];

export function isProjectileWeapon(id: string): id is ProjectileWeaponId {
  return FIREABLE.includes(id);
}

/** Weapons that hit along a line the moment they fire, with no projectile in flight. */
const HITSCAN: readonly string[] = ["pepper-shotgun"];

export function isHitscanWeapon(id: string): boolean {
  return HITSCAN.includes(id);
}

/** A pellet is traced in steps of half a voxel. */
const SCAN_STEP = FIXED_ONE >> 1;

/**
 * Fire a hitscan weapon: `shotsPerTurn` pellets at once, fanned across `spreadDegrees` of yaw.
 * Each flies straight from the muzzle until it meets terrain, another living critter, the edge
 * of the map or the end of its range, and blasts where it stops on something. Pushes a `tracer`
 * per pellet (and an `explosion` per hit) and returns the critters after the damage.
 */
export function fireHitscan(
  t: VoxelTerrain,
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): Critter[] {
  const w = loadWeapons()[cmd.weaponId];
  const yaw = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  const pitch = clampInt(cmd.pitch, PITCH_MIN, PITCH_MAX);
  const pellets = Math.max(1, Math.trunc(num(w, "shotsPerTurn", 1)));
  const fan = Math.round((num(w, "spreadDegrees", 0) * YAW_STEPS) / 360);
  const steps = Math.floor((num(w, "range", 500) * LENGTH_NUM * 2) / LENGTH_DEN);
  let cs = [...critters];
  for (let k = 0; k < pellets; k++) {
    // Pellets are spread evenly from -fan/2 to +fan/2; a single pellet flies dead centre.
    const off = pellets === 1 ? 0 : Math.round((k * fan) / (pellets - 1) - fan / 2);
    const dir = aimDir((((yaw + off) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS, pitch);
    const from = {
      x: c.pos.x + mulQ(dir.x, MUZZLE_REACH),
      y: c.pos.y + MUZZLE_HEIGHT + mulQ(dir.y, MUZZLE_REACH),
      z: c.pos.z + mulQ(dir.z, MUZZLE_REACH),
    };
    const step = {
      x: mulQ(dir.x, SCAN_STEP),
      y: mulQ(dir.y, SCAN_STEP),
      z: mulQ(dir.z, SCAN_STEP),
    };
    let pos = from;
    let hit = false;
    for (let i = 0; i < steps && !hit; i++) {
      const x = cell(pos.x);
      const y = cell(pos.y);
      const z = cell(pos.z);
      if (x < 0 || y < 0 || z < 0 || x >= t.sizeX || y >= t.sizeY || z >= t.sizeZ) break;
      hit = isSolid(t, x, y, z) || cs.some((o) => o.id !== c.id && critterHit(o, x, y, z));
      if (!hit) pos = { x: pos.x + step.x, y: pos.y + step.y, z: pos.z + step.z };
    }
    events.push({
      type: "tracer",
      critterId: c.id,
      weaponId: cmd.weaponId,
      from,
      to: pos,
      hit,
    });
    if (!hit) continue;
    const pellet: Projectile = {
      id: -1,
      ownerId: c.id,
      weaponId: cmd.weaponId,
      pos,
      vel: { x: 0, y: 0, z: 0 },
      age: 0,
      fuseTicks: -1,
      bounces: 0,
      resting: false,
    };
    cs = explode(t, cs, pellet, cell(pos.x), cell(pos.y), cell(pos.z), events);
  }
  return cs;
}

/** Weapons that act the moment they fire, with no projectile: hitscan, melee and the burrow. */
export function isInstantWeapon(id: string): boolean {
  return (
    isHitscanWeapon(id) ||
    isGearWeapon(id) ||
    isUtilityWeapon(id) ||
    id === "root-punch" ||
    id === "teleport-burrow" ||
    id === "drill-hat"
  );
}

/**
 * Fire an instant weapon. Returns the critters after it, or null if the shot is refused (a
 * burrow with no clear spot at its target), in which case nothing happened and no events were
 * pushed.
 */
export function fireInstant(
  t: VoxelTerrain,
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): Critter[] | null {
  if (cmd.weaponId === "root-punch") return punch(critters, c, cmd, events);
  if (cmd.weaponId === "teleport-burrow") return burrow(t, critters, c, cmd, events);
  if (cmd.weaponId === "drill-hat") return startDrill(critters, c, cmd);
  if (isUtilityWeapon(cmd.weaponId))
    return fireUtility(t, critters, c, { ...cmd, weaponId: cmd.weaponId }, events);
  if (isGearWeapon(cmd.weaponId))
    return startGear(t, critters, c, { ...cmd, weaponId: cmd.weaponId });
  return fireHitscan(t, critters, c, cmd, events);
}

/** Aim pitch at or below this digs straight down; anything higher digs level along the yaw. */
export const DRILL_DOWN_PITCH = -30;

/**
 * The Drill Hat: from the next tick the critter tunnels for `durationSeconds` at
 * `digSpeedCellsPerSecond`, level along the aim heading or (aimed low) straight down. Only from
 * standing; refused (null) in the air or while already drilling.
 */
function startDrill(critters: readonly Critter[], c: Critter, cmd: FireCommand): Critter[] | null {
  if (!c.grounded || c.drillTicks !== undefined || wearingGear(c)) return null;
  const w = loadWeapons()["drill-hat"];
  const yaw = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  const speed = speedPerTick(num(w, "digSpeedCellsPerSecond", 60));
  const ticks = Math.max(1, Math.trunc(num(w, "durationSeconds", 3) * TICK_RATE));
  const f = yawDir(yaw);
  const dir =
    clampInt(cmd.pitch, PITCH_MIN, PITCH_MAX) <= DRILL_DOWN_PITCH
      ? { x: 0, y: -speed, z: 0 }
      : { x: mulQ(f.x, speed), y: 0, z: mulQ(f.z, speed) };
  return critters.map((o) =>
    o.id === c.id ? { ...o, yaw, vel: { x: 0, y: 0, z: 0 }, drillTicks: ticks, drillDir: dir } : o,
  );
}

/**
 * The Root Punch: every living critter of another team within `range` of the puncher, and not
 * behind it, takes the weapon's damage and is launched along the aim heading at
 * `launchAngleDegrees`. Pushes one `punch`, then a `damage` (and maybe `died`) per critter hit.
 */
function punch(
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): Critter[] {
  const w = loadWeapons()[cmd.weaponId];
  const yaw = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  const face = yawDir(yaw);
  const reach = Math.floor((num(w, "range", 40) * LENGTH_NUM * FIXED_ONE) / LENGTH_DEN);
  const launch = aimDir(yaw, clampInt(num(w, "launchAngleDegrees", 70), PITCH_MIN, PITCH_MAX));
  const speed = speedPerTick(w.knockback);
  const hit = (o: Critter): boolean => {
    if (o.status !== "alive" || o.id === c.id || o.team === c.team) return false;
    const d = { x: o.pos.x - c.pos.x, y: o.pos.y - c.pos.y, z: o.pos.z - c.pos.z };
    return length(d) <= reach && dot({ x: d.x, y: 0, z: d.z }, face) >= 0;
  };
  events.push({
    type: "punch",
    critterId: c.id,
    at: {
      x: c.pos.x + mulQ(face.x, MUZZLE_REACH),
      y: c.pos.y + MUZZLE_HEIGHT,
      z: c.pos.z + mulQ(face.z, MUZZLE_REACH),
    },
    hits: critters.filter(hit).length,
  });
  return critters.map((o) => {
    if (!hit(o)) return o;
    if (popShield(o, events)) return dropShield(o);
    const dealt = Math.min(o.hp, w.damage);
    const hp = o.hp - dealt;
    if (dealt > 0) events.push({ type: "damage", critterId: o.id, amount: dealt, cause: "hit" });
    if (hp <= 0) events.push({ type: "died", critterId: o.id, cause: "hit" });
    return {
      ...o,
      hp,
      status: hp <= 0 ? "dead" : o.status,
      vel: { x: mulQ(launch.x, speed), y: mulQ(launch.y, speed), z: mulQ(launch.z, speed) },
      grounded: false,
      peakY: cell(o.pos.y),
    };
  });
}

/** A burrow looks this many voxels up from its target for room to stand. */
const BURROW_SEARCH_UP = 12;

/**
 * The Teleport Burrow: the critter comes up at the lowest clear spot in the target's column, at
 * or above the target voxel. Refused (null) without a target, off the map, or when the column has
 * no room or another living critter stands there. Pushes `teleported`.
 */
function burrow(
  t: VoxelTerrain,
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): Critter[] | null {
  const g = cmd.target;
  if (!g || g.x < 1 || g.z < 1 || g.x >= t.sizeX - 1 || g.z >= t.sizeZ - 1) return null;
  let y = -1;
  for (let k = 0; k <= BURROW_SEARCH_UP && y < 0; k++)
    if (g.y + k >= t.seaY && !bodyBlocked(t, g.x, g.y + k, g.z)) y = g.y + k;
  if (y < 0) return null;
  const taken = critters.some(
    (o) =>
      o.id !== c.id &&
      o.status === "alive" &&
      Math.abs(cell(o.pos.x) - g.x) <= 2 &&
      Math.abs(cell(o.pos.z) - g.z) <= 2 &&
      Math.abs(cell(o.pos.y) - y) < CRITTER_HEIGHT,
  );
  if (taken) return null;
  const half = FIXED_ONE >> 1;
  const to = { x: g.x * FIXED_ONE + half, y: y * FIXED_ONE, z: g.z * FIXED_ONE + half };
  events.push({ type: "teleported", critterId: c.id, from: c.pos, to });
  return critters.map((o) =>
    o.id === c.id ? { ...o, pos: to, vel: { x: 0, y: 0, z: 0 }, grounded: false, peakY: y } : o,
  );
}

/** Weapons whose shot in flight pops when its owner sends trigger. */
const TRIGGERABLE: readonly WeaponId[] = TRIGGERED_WEAPONS;
/** A shot can't be triggered on the tick it leaves the muzzle (or the next few). */
export const TRIGGER_MIN_AGE = 6;

function num(w: WeaponData, key: string, fallback: number): number {
  const v = w.params[key];
  return typeof v === "number" ? v : fallback;
}

function fuseRange(w: WeaponData): { min: number; max: number; def: number } {
  const v = w.params.fuseSeconds;
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    const min = typeof r.min === "number" ? r.min : 1;
    const max = typeof r.max === "number" ? r.max : 5;
    return { min, max, def: typeof r.default === "number" ? r.default : min };
  }
  return { min: 1, max: 5, def: 3 };
}

/** 2D units per second^2 -> Q16.16 voxels per tick^2. */
function accelPerTick(unitsPerSecond2: number): Fixed {
  return Math.floor(
    (unitsPerSecond2 * LENGTH_NUM * FIXED_ONE) / (LENGTH_DEN * TICK_RATE * TICK_RATE),
  );
}

/** Blast radius in whole voxels. */
export function blastRadius(w: WeaponData): number {
  return Math.floor((Math.max(0, w.blastRadius) * LENGTH_NUM) / LENGTH_DEN);
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.trunc(v)));

/** Spawn the projectiles for a fire command: [] if the weapon fires none (or lacks a target). */
export function spawnShots(
  t: VoxelTerrain,
  c: Critter,
  cmd: FireCommand,
  firstId: number,
): Projectile[] {
  if (!isProjectileWeapon(cmd.weaponId)) return [];
  const w = loadWeapons()[cmd.weaponId];
  const yaw = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  if (cmd.weaponId === "beehive-strike") return dropStrike(t, c, w, yaw, cmd.target, firstId);
  if (cmd.weaponId === "firecracker-bundle" || cmd.weaponId === "jelly-mine")
    return [dropCharge(c, w, yaw, firstId)];
  // Walkers are set down ahead and head off along the aim.
  if (FLIGHT[cmd.weaponId] === "walk" || FLIGHT[cmd.weaponId] === "drive")
    return [{ ...dropCharge(c, w, yaw, firstId), heading: yaw }];

  const pitch = clampInt(cmd.pitch, PITCH_MIN, PITCH_MAX);
  const power = clampInt(cmd.power, 0, 100);
  const dir = aimDir(yaw, pitch);
  // A seeker needs a mark and leaves at a fixed speed; everything else is charged.
  const homing = isHoming(w);
  if (homing && !cmd.target) return [];
  const fixedLaunch = homing || num(w, "launchSpeed", 0) > 0;
  const speed = fixedLaunch
    ? speedPerTick(num(w, "launchSpeed", 400))
    : mulDiv(speedPerTick(num(w, "maxSpeed", 600)), power, 100);

  let fuseTicks = -1;
  if (FLIGHT[cmd.weaponId] !== "impact" || w.params.fuseSeconds !== undefined) {
    const r = fuseRange(w);
    fuseTicks = clampInt(cmd.fuseSeconds ?? r.def, r.min, r.max) * TICK_RATE;
  }

  return [
    {
      id: firstId,
      ownerId: c.id,
      weaponId: cmd.weaponId,
      pos: {
        x: c.pos.x + mulQ(dir.x, MUZZLE_REACH),
        y: c.pos.y + MUZZLE_HEIGHT + mulQ(dir.y, MUZZLE_REACH),
        z: c.pos.z + mulQ(dir.z, MUZZLE_REACH),
      },
      vel: { x: mulQ(dir.x, speed), y: mulQ(dir.y, speed), z: mulQ(dir.z, speed) },
      age: 0,
      fuseTicks,
      bounces: 0,
      resting: false,
      ...(FLIGHT[cmd.weaponId] === "kite" ? { heading: yaw } : {}),
      ...(homing && cmd.target
        ? {
            target: {
              x: Math.trunc(cmd.target.x),
              y: Math.trunc(cmd.target.y),
              z: Math.trunc(cmd.target.z),
            },
          }
        : {}),
    },
  ];
}

/** Shots their owner drives with the walk input (RC Racer, Kite Bomber). */
export function isSteeredByOwner(id: WeaponId): boolean {
  return FLIGHT[id] === "drive" || FLIGHT[id] === "kite";
}

/** Weapons that steer toward their `target` in flight. */
function isHoming(w: WeaponData): boolean {
  return num(w, "turnAccel", 0) > 0;
}

/**
 * One tick of homing: nudge the velocity toward `cruiseSpeed` aimed at the target's centre,
 * each component by at most `turnAccel`. Returns the new velocity.
 */
function steer(
  w: WeaponData,
  target: { x: number; y: number; z: number },
  x: Fixed,
  y: Fixed,
  z: Fixed,
  v: { x: Fixed; y: Fixed; z: Fixed },
): { x: Fixed; y: Fixed; z: Fixed } {
  const half = FIXED_ONE >> 1;
  const to = {
    x: target.x * FIXED_ONE + half - x,
    y: target.y * FIXED_ONE + half - y,
    z: target.z * FIXED_ONE + half - z,
  };
  const want = withLength(to, speedPerTick(num(w, "cruiseSpeed", 400)));
  const k = accelPerTick(num(w, "turnAccel", 2400));
  const step = (cur: Fixed, goal: Fixed): Fixed => cur + clampInt(goal - cur, -k, k);
  return { x: step(v.x, want.x), y: step(v.y, want.y), z: step(v.z, want.z) };
}

/** True if any face neighbour of the voxel is solid: something for a sticky shot to cling to. */
function touchesSolid(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return (
    isSolid(t, x + 1, y, z) ||
    isSolid(t, x - 1, y, z) ||
    isSolid(t, x, y + 1, z) ||
    isSolid(t, x, y - 1, z) ||
    isSolid(t, x, y, z + 1) ||
    isSolid(t, x, y, z - 1)
  );
}

/** Charges are dropped this far in front of the feet, and this far up (Q16.16 voxels). */
const DROP_REACH = 2 * FIXED_ONE;
const DROP_HEIGHT = FIXED_ONE;

/** True for weapons that lie in wait (the Jelly Mine): no fuse until a critter comes close. */
function isMine(w: WeaponData): boolean {
  return num(w, "triggerRadius", 0) > 0;
}

/** True for a placed charge (Jelly Mine) that waits for a critter, set or not. */
export function isMineProjectile(p: Projectile): boolean {
  return isMine(loadWeapons()[p.weaponId]);
}

/** Ticks after placing before a mine can be set off. */
export function mineArmTicks(p: Projectile): number {
  return Math.trunc(num(loadWeapons()[p.weaponId], "armSeconds", 0) * TICK_RATE);
}

/** A mine lying armed or arming on the ground with no fuse running. It does not hold up a turn. */
export function isDormant(p: Projectile): boolean {
  return p.resting && p.fuseTicks < 0 && isMine(loadWeapons()[p.weaponId]);
}

/**
 * A dropped charge: set down just ahead with a nudge. The Firecracker Bundle's fuse is lit; a
 * mine has none.
 */
function dropCharge(c: Critter, w: WeaponData, yaw: number, id: number): Projectile {
  const dir = yawDir(yaw);
  const nudge = speedPerTick(num(w, "dropSpeed", 30));
  return {
    id,
    ownerId: c.id,
    weaponId: w.id as WeaponId,
    pos: {
      x: c.pos.x + mulQ(dir.x, DROP_REACH),
      y: c.pos.y + DROP_HEIGHT,
      z: c.pos.z + mulQ(dir.z, DROP_REACH),
    },
    vel: { x: mulQ(dir.x, nudge), y: 0, z: mulQ(dir.z, nudge) },
    age: 0,
    fuseTicks: isMine(w) ? -1 : fuseRange(w).def * TICK_RATE,
    bounces: 0,
    resting: false,
  };
}

/** Bombs start falling at this speed (Q16.16 voxels per tick). */
const STRIKE_DROP_SPEED = FIXED_ONE >> 2;
/** Each bomb in a strike starts this many voxels above the one before it, so they land in turn. */
const STRIKE_STAGGER = 6;
/** Strike bombs never start more than this far above the top of the grid. */
const STRIKE_CEILING = 16;

/**
 * A strike: `bombCount` bombs in a line through the target, along the aim heading, spread over
 * `spreadWidth` (2D units), dropped from `dropHeight` above the target (capped near the grid top).
 */
function dropStrike(
  t: VoxelTerrain,
  c: Critter,
  w: WeaponData,
  yaw: number,
  target: FireCommand["target"],
  firstId: number,
): Projectile[] {
  if (!target) return [];
  const n = Math.max(1, Math.trunc(num(w, "bombCount", 5)));
  const spread = Math.floor((num(w, "spreadWidth", 160) * LENGTH_NUM) / LENGTH_DEN);
  const drop = Math.floor((num(w, "dropHeight", 600) * LENGTH_NUM) / LENGTH_DEN);
  const cx = cosYaw(yaw);
  const sz = sinYaw(yaw);
  const half = FIXED_ONE >> 1;
  const out: Projectile[] = [];
  for (let k = 0; k < n; k++) {
    // Offset along the line in Q16.16 voxels: -spread/2 .. +spread/2.
    const off = n === 1 ? 0 : Math.floor((spread * FIXED_ONE * (2 * k - (n - 1))) / (2 * (n - 1)));
    const y = Math.min(target.y + drop, t.sizeY + STRIKE_CEILING) + k * STRIKE_STAGGER;
    out.push({
      id: firstId + k,
      ownerId: c.id,
      weaponId: "beehive-bomb",
      pos: {
        x: target.x * FIXED_ONE + half + mulQ(cx, off),
        y: y * FIXED_ONE + half,
        z: target.z * FIXED_ONE + half + mulQ(sz, off),
      },
      vel: { x: 0, y: -STRIKE_DROP_SPEED, z: 0 },
      age: 0,
      fuseTicks: -1,
      bounces: 0,
      resting: false,
    });
  }
  return out;
}

/**
 * The sub-munitions of a cluster shot that burst at voxel (x, y, z): `subCount` of them, fanned
 * evenly around a heading picked from the shot's id, at `subPitch` degrees. A mid-air burst keeps
 * half of the parent's velocity; an impact burst does not (it would drive them into the ground).
 */
function burst(
  p: Projectile,
  w: WeaponData,
  x: number,
  y: number,
  z: number,
  midAir: boolean,
  firstId: number,
): Projectile[] {
  const sub = w.params.subMunition;
  if (typeof sub !== "string" || !(sub in loadWeapons())) return [];
  const n = Math.max(0, Math.trunc(num(w, "subCount", 5)));
  const speed = speedPerTick(num(w, "subSpeed", 150));
  const pitch = clampInt(num(w, "subPitch", 50), PITCH_MIN, PITCH_MAX);
  const base = (p.id * 211) % YAW_STEPS;
  const half = FIXED_ONE >> 1;
  const out: Projectile[] = [];
  for (let k = 0; k < n; k++) {
    const dir = aimDir((base + Math.floor((k * YAW_STEPS) / n)) % YAW_STEPS, pitch);
    out.push({
      id: firstId + k,
      ownerId: p.ownerId,
      weaponId: sub as WeaponId,
      pos: { x: x * FIXED_ONE + half, y: y * FIXED_ONE + half, z: z * FIXED_ONE + half },
      vel: {
        x: mulQ(dir.x, speed) + (midAir ? p.vel.x >> 1 : 0),
        y: mulQ(dir.y, speed) + (midAir ? p.vel.y >> 1 : 0),
        z: mulQ(dir.z, speed) + (midAir ? p.vel.z >> 1 : 0),
      },
      age: 0,
      fuseTicks: -1,
      bounces: 0,
      resting: false,
    });
  }
  return out;
}

/** True if voxel (px, py, pz) is inside a living critter's body cylinder. */
function critterHit(c: Critter, px: number, py: number, pz: number): boolean {
  if (c.status !== "alive") return false;
  const dy = py - cell(c.pos.y);
  return (
    Math.abs(px - cell(c.pos.x)) <= 1 &&
    Math.abs(pz - cell(c.pos.z)) <= 1 &&
    dy >= 0 &&
    dy < CRITTER_HEIGHT
  );
}

/** True if a living critter's body centre is within `units` (2D units) of the point. */
function critterNear(cs: readonly Critter[], x: Fixed, y: Fixed, z: Fixed, units: number): boolean {
  const reach = Math.floor((units * LENGTH_NUM * FIXED_ONE) / LENGTH_DEN);
  return cs.some(
    (c) =>
      c.status === "alive" &&
      length({
        x: c.pos.x - x,
        y: c.pos.y + (CRITTER_HEIGHT * FIXED_ONE) / 2 - y,
        z: c.pos.z - z,
      }) <= reach,
  );
}

/**
 * Detonate centred on voxel (x, y, z): carve the terrain in place, then damage and knock back
 * living critters in range with linear falloff, measured to the body centre in Q16.16.
 */
export function explode(
  t: VoxelTerrain,
  critters: readonly Critter[],
  p: Projectile,
  x: number,
  y: number,
  z: number,
  events: SimEvent[],
): Critter[] {
  const w = loadWeapons()[p.weaponId];
  // Weapons that wind up as they bounce (the Hopper Ball) blast a little wider per bounce.
  const grow = Math.min(
    Math.trunc(num(w, "maxGrowth", 0)),
    p.bounces * Math.trunc(num(w, "growPerBounce", 0)),
  );
  const r = blastRadius(w) + Math.max(0, grow);
  const edit = { op: "carve", x, y, z, r } as const;
  // A Snow Globe's flurry freezes critters and leaves the ground alone.
  const freeze = w.params.freeze === true;
  if (!freeze && r > 0) applyEdit(t, edit);
  events.push({ type: "explosion", projectileId: p.id, weaponId: p.weaponId, edit });
  if (r === 0) return [...critters];

  const half = FIXED_ONE >> 1;
  const rq = r * FIXED_ONE;
  const knock = speedPerTick(w.knockback);
  const cap = 2 * TERMINAL_VELOCITY;
  const clampV = (v: Fixed): Fixed => Math.max(-cap, Math.min(cap, v));

  return critters.map((c) => {
    if (c.status !== "alive") return c;
    const d = {
      x: c.pos.x - (x * FIXED_ONE + half),
      y: c.pos.y + (CRITTER_HEIGHT * FIXED_ONE) / 2 - (y * FIXED_ONE + half),
      z: c.pos.z - (z * FIXED_ONE + half),
    };
    const dist = length(d);
    if (dist >= rq) return c;
    const falloff = rq - dist; // (0, rq]
    const amount = mulDiv(w.damage, falloff, rq);
    const mag = mulDiv(knock, falloff, rq);
    if ((amount > 0 || mag > 0 || freeze) && popShield(c, events)) return dropShield(c);
    if (freeze) {
      if (c.frozen) return c;
      events.push({ type: "frozen", critterId: c.id });
      return { ...c, frozen: true as const };
    }
    const push = dist === 0 ? { x: 0, y: mag, z: 0 } : withLength(d, mag);

    let hp = c.hp;
    let status: Critter["status"] = c.status;
    if (amount > 0) {
      const dealt = Math.min(hp, amount);
      hp -= dealt;
      events.push({ type: "damage", critterId: c.id, amount: dealt, cause: "explosion" });
      if (hp <= 0) {
        status = "dead";
        events.push({ type: "died", critterId: c.id, cause: "explosion" });
      }
    }
    return {
      ...c,
      hp: Math.max(0, Math.min(MAX_HEALTH, hp)),
      status,
      vel: {
        x: clampV(c.vel.x + push.x),
        y: clampV(c.vel.y + push.y),
        z: clampV(c.vel.z + push.z),
      },
      grounded: false,
      peakY: cell(c.pos.y),
    };
  });
}

/** True if the voxel under (x, y, z) is solid. */
function isSolidBelow(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return isSolid(t, x, y - 1, z);
}

/** Unit bounce normal at a solid voxel, entered from voxel (fx, fy, fz). */
function bounceNormal(
  t: VoxelTerrain,
  hx: number,
  hy: number,
  hz: number,
  fx: number,
  fy: number,
  fz: number,
) {
  const g = normalAt(t, hx, hy, hz);
  // Gradients are small integers; scale to Q16.16 before normalising.
  let n = { x: g.x * FIXED_ONE, y: g.y * FIXED_ONE, z: g.z * FIXED_ONE };
  if (n.x === 0 && n.y === 0 && n.z === 0)
    n = { x: (fx - hx) * FIXED_ONE, y: (fy - hy) * FIXED_ONE, z: (fz - hz) * FIXED_ONE };
  return withLength(n, FIXED_ONE);
}

export interface ProjectileStep {
  readonly projectiles: Projectile[];
  readonly critters: Critter[];
  /** The next free projectile id (bursts allocate ids). */
  readonly nextId: number;
  /** Puddles left by this tick's blasts (Hot Sauce Flask, Glue Puddle). */
  readonly zones: Zone[];
}

/**
 * Advance every projectile one tick, in array order. Explosions edit the terrain in place.
 * `triggers` holds the critters that sent trigger this tick. Sub-munitions from a burst join
 * the list after every existing projectile and first move on the next tick.
 */
export function stepProjectiles(
  t: VoxelTerrain,
  projectiles: readonly Projectile[],
  critters: readonly Critter[],
  windX: number,
  windZ: number,
  events: SimEvent[],
  triggers: ReadonlySet<number> = new Set(),
  nextId = 0,
  /** Events from earlier this tick whose blasts (hitscan hits) can also set off charges. */
  earlier: readonly SimEvent[] = [],
  /** Current soda row (SimState.seaY, which rises in sudden death); dormant mines below it sink. */
  seaY = t.seaY,
  /** Owner id -> walk heading (or -1) for owners steering an RC Racer or Kite Bomber. */
  steering: ReadonlyMap<number, number> = new Map(),
): ProjectileStep {
  let cs: Critter[] = [...critters];
  const next: Projectile[] = [];
  const spawned: Projectile[] = [];
  const zones: Zone[] = [];
  let id = nextId;

  for (const p of projectiles) {
    const w = loadWeapons()[p.weaponId];
    let { x, y, z } = p.pos;
    let vx = p.vel.x;
    let vy = p.vel.y;
    let vz = p.vel.z;
    let { bounces, resting } = p;
    let fuse = p.fuseTicks < 0 ? -1 : p.fuseTicks - 1;
    const mine = isMine(w);
    const armTicks = Math.trunc(num(w, "armSeconds", 0) * TICK_RATE);
    const flight = FLIGHT[p.weaponId] ?? "impact";
    const impact = flight === "impact";
    const stick = flight === "stick";
    const roll = flight === "roll";
    const steered = flight === "walk" || flight === "drive" || flight === "kite";
    let heading = p.heading;
    const stickFuse = Math.max(1, Math.trunc(num(w, "stickFuseSeconds", 2) * TICK_RATE));
    let blast: { x: number; y: number; z: number } | null = null;
    let midAir = false;

    if (TRIGGERABLE.includes(p.weaponId) && p.age >= TRIGGER_MIN_AGE && triggers.has(p.ownerId)) {
      blast = { x: cell(x), y: cell(y), z: cell(z) };
      midAir = true;
    }

    // Ground carved away: a resting shot falls again (a sticky one only once nothing is left).
    if (resting && !(stick ? touchesSolid : isSolidBelow)(t, cell(x), cell(y), cell(z)))
      resting = false;

    if (steered && blast === null) {
      const m = steerStep(
        t,
        flight,
        { x, y, z },
        { x: vx, y: vy, z: vz },
        heading ?? 0,
        steering.get(p.ownerId) ?? -1,
        speedPerTick(
          num(
            w,
            flight === "kite" ? "flySpeed" : flight === "drive" ? "driveSpeed" : "walkSpeed",
            40,
          ),
        ),
        accelPerTick(num(w, "gravity", 600)),
        w.windAffected
          ? {
              x:
                clampInt(windX, -100, 100) *
                WIND_ACCEL_PER_UNIT *
                Math.trunc(num(w, "windScale", 1)),
              z:
                clampInt(windZ, -100, 100) *
                WIND_ACCEL_PER_UNIT *
                Math.trunc(num(w, "windScale", 1)),
            }
          : { x: 0, z: 0 },
        2 * TERMINAL_VELOCITY,
      );
      ({ x, y, z, vx, vy, vz, heading } = m);
      if (m.crashed) {
        blast = { x: cell(x), y: cell(y), z: cell(z) };
        midAir = true;
      } else if (
        cell(y) < seaY ||
        cell(x) < -LOST_MARGIN ||
        cell(x) > t.sizeX + LOST_MARGIN ||
        cell(z) < -LOST_MARGIN ||
        cell(z) > t.sizeZ + LOST_MARGIN
      ) {
        events.push({ type: "projectileLost", projectileId: p.id });
        continue;
      }
    }

    if (!steered && !resting && blast === null) {
      if (p.target && p.age >= Math.trunc(num(w, "homingDelaySeconds", 0) * TICK_RATE))
        ({ x: vx, y: vy, z: vz } = steer(w, p.target, x, y, z, { x: vx, y: vy, z: vz }));
      // A rocket flies flat for `flatSeconds`; a shot under a Feather Charm falls at half gravity.
      const g = accelPerTick(num(w, "gravity", 600));
      if (p.age >= Math.trunc(num(w, "flatSeconds", 0) * TICK_RATE))
        vy = Math.max(vy - (p.light ? g >> 1 : g), -2 * TERMINAL_VELOCITY);
      if (w.windAffected) {
        vx += clampInt(windX, -100, 100) * WIND_ACCEL_PER_UNIT;
        vz += clampInt(windZ, -100, 100) * WIND_ACCEL_PER_UNIT;
      }
      const n = Math.max(
        1,
        (Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz)) + FIXED_ONE - 1) >> 16,
      );
      for (let i = 0; i < n && blast === null; i++) {
        const nx = x + idiv(vx, n);
        const ny = y + idiv(vy, n);
        const nz = z + idiv(vz, n);
        const hx = cell(nx);
        const hy = cell(ny);
        const hz = cell(nz);
        if (isSolid(t, hx, hy, hz)) {
          if (stick) {
            vx = 0;
            vy = 0;
            vz = 0;
            resting = true;
            if (fuse < 0) fuse = stickFuse;
            break;
          }
          if (impact) {
            blast = { x: cell(x), y: cell(y), z: cell(z) }; // last empty voxel
            break;
          }
          const normal = bounceNormal(t, hx, hy, hz, cell(x), cell(y), cell(z));
          const v = { x: vx, y: vy, z: vz };
          if (roll) {
            // Slide along the surface: drop the part of the speed going into it, keep the rest
            // (gravity's pull along a slope is what rolls it downhill), and try again.
            const into = dot(v, normal);
            const friction = Math.floor(num(w, "rollFriction", 0.995) * FIXED_ONE);
            if (into < 0) {
              vx = mulQ(vx - mulQ(normal.x, into), friction);
              vy = mulQ(vy - mulQ(normal.y, into), friction);
              vz = mulQ(vz - mulQ(normal.z, into), friction);
            }
            // A marble keeps rolling far slower than a grenade would settle.
            const slow = Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < REST_SPEED >> 2;
            if (slow && isSolid(t, cell(x), cell(y) - 1, cell(z))) {
              vx = 0;
              vy = 0;
              vz = 0;
              resting = true;
              break;
            }
            // Take this sub-step along the surface instead, if that is clear.
            const sx = x + idiv(vx, n);
            const sy = y + idiv(vy, n);
            const sz = z + idiv(vz, n);
            if (!isSolid(t, cell(sx), cell(sy), cell(sz))) {
              x = sx;
              y = sy;
              z = sz;
            } else if (!isSolid(t, cell(sx), cell(y), cell(sz))) {
              x = sx;
              z = sz;
            }
            continue;
          }
          if (dot(v, normal) < 0) {
            const bounce = Math.floor(num(w, "bounciness", 0.45) * FIXED_ONE);
            const r = reflect(v, normal);
            vx = mulQ(r.x, bounce);
            vy = mulQ(r.y, bounce);
            vz = mulQ(r.z, bounce);
          }
          bounces++;
          events.push({ type: "bounced", projectileId: p.id });
          const slow = Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < REST_SPEED;
          const grounded = isSolid(t, cell(x), cell(y) - 1, cell(z));
          if (slow || (bounces >= num(w, "maxBounces", 3) && grounded)) {
            vx = 0;
            vy = 0;
            vz = 0;
            resting = true;
          }
          break;
        }
        x = nx;
        y = ny;
        z = nz;
        if (
          (impact || stick) &&
          cs.some(
            (c) => (c.id !== p.ownerId || p.age > OWNER_GRACE_TICKS) && critterHit(c, hx, hy, hz),
          )
        ) {
          if (impact) blast = { x: hx, y: hy, z: hz };
          else {
            // A gumball on a critter clings there (in the air beside it) and its fuse starts.
            vx = 0;
            vy = 0;
            vz = 0;
            resting = true;
            if (fuse < 0) fuse = stickFuse;
            break;
          }
        }
      }

      const lost =
        p.age >= MAX_PROJECTILE_AGE_TICKS ||
        cell(y) > t.sizeY + LOST_ALTITUDE ||
        cell(x) < -LOST_MARGIN ||
        cell(x) > t.sizeX + LOST_MARGIN ||
        cell(z) < -LOST_MARGIN ||
        cell(z) > t.sizeZ + LOST_MARGIN;
      if (blast === null && lost) {
        events.push({ type: "projectileLost", projectileId: p.id });
        continue;
      }
    }

    if (mine && blast === null) {
      if (cell(y) < seaY) {
        events.push({ type: "projectileLost", projectileId: p.id }); // sank
        continue;
      }
      if (fuse < 0 && p.age >= armTicks && critterNear(cs, x, y, z, num(w, "triggerRadius", 0))) {
        fuse = Math.max(1, Math.trunc(num(w, "triggerDelayTicks", 15)));
        events.push({ type: "mineTriggered", projectileId: p.id });
      }
    }
    if (blast === null && fuse === 0) blast = { x: cell(x), y: cell(y), z: cell(z) };
    if (blast !== null) {
      cs = explode(t, cs, p, blast.x, blast.y, blast.z, events);
      const puddle = zoneFrom(t, p, blast.x, blast.y, blast.z);
      if (puddle) zones.push(puddle);
      const subs = burst(p, w, blast.x, blast.y, blast.z, midAir, id);
      id += subs.length;
      spawned.push(...subs);
      continue;
    }
    next.push({
      ...p,
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      // A mine's age only counts up to armed, so one shaken loose years later still falls.
      age: mine ? Math.min(p.age + 1, armTicks) : p.age + 1,
      fuseTicks: fuse,
      bounces,
      resting,
      ...(heading !== undefined ? { heading } : {}),
    });
  }
  return {
    projectiles: chain([...next, ...spawned], [...earlier, ...events]),
    critters: cs,
    nextId: id,
    zones,
  };
}

/**
 * Charges that chain (a `chainFuseTicks` param, like the Firecracker Bundle) caught inside a
 * blast this tick have their fuse cut to that many ticks.
 */
function chain(ps: Projectile[], events: readonly SimEvent[]): Projectile[] {
  const blasts: { x: number; y: number; z: number; r: number }[] = [];
  for (const e of events)
    if (e.type === "explosion" && e.edit.op !== "box")
      blasts.push({ x: e.edit.x, y: e.edit.y, z: e.edit.z, r: e.edit.r });
  if (blasts.length === 0) return ps;
  return ps.map((p) => {
    const cut = num(loadWeapons()[p.weaponId], "chainFuseTicks", 0);
    if (cut <= 0 || (p.fuseTicks >= 0 && p.fuseTicks <= cut)) return p;
    const px = cell(p.pos.x);
    const py = cell(p.pos.y);
    const pz = cell(p.pos.z);
    const hit = blasts.some(
      (b) => (px - b.x) ** 2 + (py - b.y) ** 2 + (pz - b.z) ** 2 <= (b.r + 1) ** 2,
    );
    return hit ? { ...p, fuseTicks: cut } : p;
  });
}
