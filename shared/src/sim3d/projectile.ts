// Projectiles are points marched through the voxels in substeps of at most one voxel per axis.
// Impact weapons detonate in the last empty voxel before solid terrain or on a critter; bouncing
// weapons reflect off the integer density gradient and lose energy until their fuse runs out.

import type { Fixed } from "../fixed";
import { FIXED_ONE, idiv } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import type { Critter, FireCommand, Projectile, SimEvent } from "./api";
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
import { cell } from "./critter";
import { applyEdit, isSolid, normalAt } from "./terrainOps";
import { aimDir, dot, length, mulDiv, mulQ, reflect, withLength } from "./vec3";

/** The weapons sim3d can fire so far (the 3D-M2 pair). */
export type ProjectileWeaponId = "acorn-mortar" | "fizz-grenade";

export function isProjectileWeapon(id: string): id is ProjectileWeaponId {
  return id === "acorn-mortar" || id === "fizz-grenade";
}

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

/** 2D units per second (weapon JSON) -> Q16.16 voxels per tick. */
function speedPerTick(unitsPerSecond: number): Fixed {
  return Math.floor((unitsPerSecond * LENGTH_NUM * FIXED_ONE) / (LENGTH_DEN * TICK_RATE));
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

/** Spawn a projectile for a fire command, or null if the weapon is not a projectile weapon. */
export function spawnProjectile(c: Critter, cmd: FireCommand, id: number): Projectile | null {
  if (!isProjectileWeapon(cmd.weaponId)) return null;
  const w = loadWeapons()[cmd.weaponId];
  const yaw = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  const pitch = clampInt(cmd.pitch, PITCH_MIN, PITCH_MAX);
  const power = clampInt(cmd.power, 0, 100);
  const dir = aimDir(yaw, pitch);
  const speed = mulDiv(speedPerTick(num(w, "maxSpeed", 600)), power, 100);

  let fuseTicks = -1;
  if (cmd.weaponId === "fizz-grenade") {
    const r = fuseRange(w);
    fuseTicks = clampInt(cmd.fuseSeconds ?? r.def, r.min, r.max) * TICK_RATE;
  }

  return {
    id,
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
  };
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
  const r = blastRadius(w);
  const edit = { op: "carve", x, y, z, r } as const;
  applyEdit(t, edit);
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
}

/** Advance every projectile one tick, in array order. Explosions edit the terrain in place. */
export function stepProjectiles(
  t: VoxelTerrain,
  projectiles: readonly Projectile[],
  critters: readonly Critter[],
  windX: number,
  windZ: number,
  events: SimEvent[],
): ProjectileStep {
  let cs: Critter[] = [...critters];
  const next: Projectile[] = [];

  for (const p of projectiles) {
    const w = loadWeapons()[p.weaponId];
    let { x, y, z } = p.pos;
    let vx = p.vel.x;
    let vy = p.vel.y;
    let vz = p.vel.z;
    let { bounces, resting } = p;
    const fuse = p.fuseTicks < 0 ? -1 : p.fuseTicks - 1;
    let blast: { x: number; y: number; z: number } | null = null;

    if (resting && !isSolid(t, cell(x), cell(y) - 1, cell(z))) resting = false; // ground carved away

    if (!resting) {
      vy = Math.max(vy - accelPerTick(num(w, "gravity", 600)), -2 * TERMINAL_VELOCITY);
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
          if (p.weaponId === "acorn-mortar") {
            blast = { x: cell(x), y: cell(y), z: cell(z) }; // last empty voxel
            break;
          }
          const normal = bounceNormal(t, hx, hy, hz, cell(x), cell(y), cell(z));
          const v = { x: vx, y: vy, z: vz };
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
          p.weaponId === "acorn-mortar" &&
          cs.some(
            (c) => (c.id !== p.ownerId || p.age > OWNER_GRACE_TICKS) && critterHit(c, hx, hy, hz),
          )
        )
          blast = { x: hx, y: hy, z: hz };
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

    if (blast === null && fuse === 0) blast = { x: cell(x), y: cell(y), z: cell(z) };
    if (blast !== null) {
      cs = explode(t, cs, p, blast.x, blast.y, blast.z, events);
      continue;
    }
    next.push({
      ...p,
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      age: p.age + 1,
      fuseTicks: fuse,
      bounces,
      resting,
    });
  }
  return { projectiles: next, critters: cs };
}
