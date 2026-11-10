import type { Fixed } from "../fixed";
import { cosDeg, FIXED_ONE, fmul, idiv, isqrt, sinDeg, toFixed } from "../fixed";
import { carveCircle, isSolid, surfaceNormal } from "../terrain";
import type { Terrain } from "../terrain";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import {
  CRITTER_HALF_WIDTH,
  CRITTER_HEIGHT,
  MAX_HEALTH,
  TICK_RATE,
  TERMINAL_VELOCITY,
  WIND_ACCEL_PER_UNIT,
} from "./constants";
import type { Critter, FireCommand, Projectile, ProjectileWeaponId, SimEvent } from "./types";

const cell = (f: Fixed): number => f >> 16;

/** Muzzle sits this far above the feet and this far along the aim direction. */
const MUZZLE_HEIGHT = 12;
const MUZZLE_REACH = 10;
/** The owner cannot be hit by its own projectile for this many ticks after firing. */
const OWNER_GRACE_TICKS = 12;
/** A bouncing grenade slower than this (cells per tick, summed axes) stops and rests. */
const REST_SPEED = toFixed(0.4);
/** Projectiles this far outside the map are discarded. */
const LOST_MARGIN = 300;

export function isProjectileWeapon(id: string): id is ProjectileWeaponId {
  return id === "acorn-mortar" || id === "fizz-grenade";
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

function range(
  params: Readonly<Record<string, unknown>>,
  key: string,
): { min: number; max: number; def: number } {
  const v = params[key];
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    const min = typeof r.min === "number" ? r.min : 1;
    const max = typeof r.max === "number" ? r.max : 5;
    return { min, max, def: typeof r.default === "number" ? r.default : min };
  }
  return { min: 1, max: 5, def: 3 };
}

/** Units per second -> Q16.16 cells per tick, rounded the same way on every platform. */
function perTick(unitsPerSecond: number): Fixed {
  return Math.round((unitsPerSecond * FIXED_ONE) / TICK_RATE) | 0;
}

function gravityPerTick(w: WeaponData): Fixed {
  return Math.round((num(w.params, "gravity", 600) * FIXED_ONE) / (TICK_RATE * TICK_RATE)) | 0;
}

/** Spawn a projectile for a fire command, or null if the weapon is unsupported. */
export function spawnProjectile(
  c: Critter,
  cmd: FireCommand,
  id: number,
): { projectile: Projectile; facing: -1 | 1 } | null {
  if (!isProjectileWeapon(cmd.weaponId)) return null;
  const w = loadWeapons()[cmd.weaponId];
  const power = Math.max(0, Math.min(100, Math.trunc(cmd.power)));
  const cos = cosDeg(cmd.angleDeg);
  const sin = sinDeg(cmd.angleDeg);
  const maxSpeed = perTick(num(w.params, "maxSpeed", 600));
  const speed = idiv(maxSpeed * power, 100) | 0;

  let fuseTicks = -1;
  if (cmd.weaponId === "fizz-grenade") {
    const r = range(w.params, "fuseSeconds");
    const secs = Math.max(r.min, Math.min(r.max, cmd.fuseSeconds ?? r.def));
    fuseTicks = Math.round(secs * TICK_RATE);
  }

  const projectile: Projectile = {
    id,
    ownerId: c.id,
    weaponId: cmd.weaponId,
    x: (c.x + MUZZLE_REACH * cos) | 0,
    y: (c.y - MUZZLE_HEIGHT * FIXED_ONE - MUZZLE_REACH * sin) | 0,
    vx: fmul(speed, cos),
    vy: -fmul(speed, sin) | 0,
    age: 0,
    fuseTicks,
    bounces: 0,
    resting: false,
  };
  return { projectile, facing: cos < 0 ? -1 : 1 };
}

function critterHit(c: Critter, px: number, py: number): boolean {
  if (c.status !== "alive") return false;
  const dy = cell(c.y) - py;
  return Math.abs(px - cell(c.x)) <= CRITTER_HALF_WIDTH && dy >= 0 && dy < CRITTER_HEIGHT;
}

/**
 * Detonate at cell (x, y): carve the terrain, then damage and knock back critters in range with
 * linear falloff. Returns the updated critter list. Terrain is changed in place (the sim's only
 * shared mutable resource); the emitted `explosion` event lets replays and clients re-apply it.
 */
export function explode(
  terrain: Terrain,
  critters: readonly Critter[],
  p: Projectile,
  x: number,
  y: number,
  events: SimEvent[],
): Critter[] {
  const w = loadWeapons()[p.weaponId];
  const radius = Math.max(0, Math.trunc(w.blastRadius));
  const carved = carveCircle(terrain, x, y, radius);
  events.push({
    type: "explosion",
    projectileId: p.id,
    weaponId: p.weaponId,
    x,
    y,
    radius,
    cellsRemoved: carved.cellsRemoved,
  });

  return critters.map((c) => {
    if (c.status === "drowned" || radius === 0) return c;
    // Distance to the body centre.
    const cx = cell(c.x);
    const cy = cell(c.y) - (CRITTER_HEIGHT >> 1);
    const dx = cx - x;
    const dy = cy - y;
    const dist = isqrt(dx * dx + dy * dy);
    if (dist >= radius) return c;
    const falloff = radius - dist; // 0..radius
    const amount = Math.floor((w.damage * falloff) / radius);

    // Direction away from the blast (straight up when exactly at the centre).
    const nx = dist === 0 ? 0 : idiv(dx * FIXED_ONE, dist);
    const ny = dist === 0 ? -FIXED_ONE : idiv(dy * FIXED_ONE, dist);
    const mag = idiv(perTick(w.knockback) * falloff, radius);
    const kvx = fmul(nx, mag);
    const kvy = fmul(ny, mag);

    let hp = c.hp;
    let status = c.status;
    if (status === "alive" && amount > 0) {
      const dealt = Math.min(hp, amount);
      hp -= dealt;
      events.push({ type: "damage", critterId: c.id, amount: dealt, cause: "explosion" });
      if (hp <= 0) {
        status = "dead";
        events.push({ type: "died", critterId: c.id, cause: "explosion" });
      }
    }
    const clampV = (v: Fixed): Fixed =>
      Math.max(-TERMINAL_VELOCITY * 2, Math.min(TERMINAL_VELOCITY * 2, v)) | 0;
    return {
      ...c,
      hp: Math.max(0, Math.min(MAX_HEALTH, hp)),
      status,
      vx: clampV(c.vx + kvx),
      vy: clampV(c.vy + kvy),
      grounded: false,
      peakY: cell(c.y),
    };
  });
}

export interface ProjectileStep {
  readonly projectiles: Projectile[];
  readonly critters: Critter[];
}

/** Advance every projectile one tick. Explosions are resolved in projectile order for determinism. */
export function stepProjectiles(
  terrain: Terrain,
  projectiles: readonly Projectile[],
  critters: readonly Critter[],
  wind: number,
  events: SimEvent[],
): ProjectileStep {
  let cs: Critter[] = [...critters];
  const next: Projectile[] = [];

  for (const p of projectiles) {
    const w = loadWeapons()[p.weaponId];
    let { x, y, vx, vy, bounces, resting } = p;
    const fuse = p.fuseTicks < 0 ? -1 : p.fuseTicks - 1;
    let detonateAt: { x: number; y: number } | null = null;

    if (resting && !isSolid(terrain, cell(x), cell(y) + 1)) resting = false; // ground was carved away

    if (!resting) {
      vy = (vy + gravityPerTick(w)) | 0;
      if (w.windAffected) vx = (vx + wind * WIND_ACCEL_PER_UNIT) | 0;
      vy = Math.min(vy, TERMINAL_VELOCITY * 2) | 0;

      const n = Math.max(1, (Math.max(Math.abs(vx), Math.abs(vy)) + FIXED_ONE - 1) >> 16);
      for (let i = 0; i < n && detonateAt === null; i++) {
        const nx = (x + idiv(vx, n)) | 0;
        const ny = (y + idiv(vy, n)) | 0;
        const hitX = cell(nx);
        const hitY = cell(ny);

        if (p.weaponId === "acorn-mortar") {
          if (isSolid(terrain, hitX, hitY)) {
            detonateAt = { x: hitX, y: hitY };
          } else if (
            cs.some(
              (c) => (c.id !== p.ownerId || p.age > OWNER_GRACE_TICKS) && critterHit(c, hitX, hitY),
            )
          ) {
            detonateAt = { x: hitX, y: hitY };
          }
          x = nx;
          y = ny;
        } else if (isSolid(terrain, hitX, hitY)) {
          // Grenade: reflect off the surface and lose energy.
          const normal = surfaceNormal(terrain, hitX, hitY);
          const flat = normal.nx === 0 && normal.ny === 0;
          const sx = normal.nx;
          const sy = flat ? -FIXED_ONE : normal.ny;
          const dot = (fmul(vx, sx) + fmul(vy, sy)) | 0;
          if (dot < 0) {
            const bounce = toFixed(num(w.params, "bounciness", 0.45));
            vx = fmul((vx - 2 * fmul(dot, sx)) | 0, bounce);
            vy = fmul((vy - 2 * fmul(dot, sy)) | 0, bounce);
          }
          bounces++;
          events.push({ type: "bounced", projectileId: p.id });
          const slow = Math.abs(vx) + Math.abs(vy) < REST_SPEED;
          if (slow || bounces >= num(w.params, "maxBounces", 3)) {
            if (isSolid(terrain, cell(x), cell(y) + 1) || slow) {
              vx = 0;
              vy = 0;
              resting = true;
            }
          }
          break;
        } else {
          x = nx;
          y = ny;
        }
      }

      if (
        detonateAt === null &&
        (cell(x) < -LOST_MARGIN ||
          cell(x) > terrain.width + LOST_MARGIN ||
          cell(y) > terrain.height + LOST_MARGIN)
      ) {
        events.push({ type: "projectileLost", projectileId: p.id });
        continue;
      }
    }

    if (detonateAt === null && fuse === 0) detonateAt = { x: cell(x), y: cell(y) };
    if (detonateAt !== null) {
      cs = explode(terrain, cs, p, detonateAt.x, detonateAt.y, events);
      continue;
    }
    next.push({ ...p, x, y, vx, vy, age: p.age + 1, fuseTicks: fuse, bounces, resting });
  }
  return { projectiles: next, critters: cs };
}
