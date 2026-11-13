// Movement utilities worn by a critter: Spring Boots (one very high jump with a soft landing),
// the Soda Jetpack (bursts of thrust on jump while airborne) and the Umbrella Glide (slow,
// steerable fall). None ends the turn. Starting one is an instant weapon (projectile.ts routes
// here); the per-tick effect lives in stepCritter. Every field is dropped on landing.

import type { Fixed } from "../fixed";
import { FIXED_ONE } from "../fixed";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import type { Critter, FireCommand } from "./api";
import { YAW_STEPS } from "./api";
import { LENGTH_DEN, LENGTH_NUM, TICK_RATE } from "./constants";
import { aimDir, mulQ, yawDir } from "./vec3";

/** 2D units per second -> Q16.16 voxels per tick. */
export function speedPerTick(unitsPerSecond: number): Fixed {
  return Math.floor((unitsPerSecond * LENGTH_NUM * FIXED_ONE) / (LENGTH_DEN * TICK_RATE));
}

/** 2D length -> whole voxels. */
const voxels = (units: number): number => Math.floor((units * LENGTH_NUM) / LENGTH_DEN);

function param(w: WeaponData, key: string, fallback: number): number {
  const v = w.params[key];
  return typeof v === "number" ? v : fallback;
}

const wrapYaw = (yaw: number): number => ((Math.trunc(yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;

/** The utilities in this file. */
export const GEAR_WEAPONS = ["spring-boots", "soda-jetpack", "umbrella-glide"] as const;
export type GearWeapon = (typeof GEAR_WEAPONS)[number];

export function isGearWeapon(id: string): id is GearWeapon {
  return (GEAR_WEAPONS as readonly string[]).includes(id);
}

/** True while the critter wears any gear (it is then mid-air by construction). */
export function wearingGear(c: Critter): boolean {
  return c.safeFall !== undefined || c.jetFuel !== undefined || c.umbrella !== undefined;
}

/** The critter without any gear fields. */
export function dropGear(c: Critter): Critter {
  if (!wearingGear(c)) return c;
  const { safeFall: _s, jetFuel: _j, umbrella: _u, ...rest } = c;
  void _s;
  void _j;
  void _u;
  return rest;
}

/** One Soda Jetpack burst: up at least `burstUpSpeed`, and `burstForwardSpeed` along the facing. */
export function jetBurst(c: Critter, vel: { x: Fixed; y: Fixed; z: Fixed }): typeof vel {
  const w = loadWeapons()["soda-jetpack"];
  const up = speedPerTick(param(w, "burstUpSpeed", 240));
  const fwd = speedPerTick(param(w, "burstForwardSpeed", 100));
  const f = yawDir(c.yaw);
  return { x: mulQ(f.x, fwd), y: Math.max(vel.y, up), z: mulQ(f.z, fwd) };
}

/** Umbrella fall cap and steering speed, Q16.16 voxels per tick. */
export function umbrellaSpeeds(): { fall: Fixed; drift: Fixed } {
  const w = loadWeapons()["umbrella-glide"];
  return {
    fall: speedPerTick(param(w, "fallSpeed", 30)),
    drift: speedPerTick(param(w, "driftSpeed", 40)),
  };
}

/**
 * Put gear on. Returns the critters after, or null if refused: Spring Boots need ground under
 * the feet, the umbrella needs air under them, and nothing stacks with gear already worn.
 */
export function startGear(
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand & { weaponId: GearWeapon },
): Critter[] | null {
  if (wearingGear(c) || c.drillTicks !== undefined) return null;
  const yaw = wrapYaw(cmd.yaw);
  let next: Critter;
  if (cmd.weaponId === "spring-boots") {
    if (!c.grounded) return null;
    const w = loadWeapons()["spring-boots"];
    const max = Math.trunc(param(w, "maxAngleDegrees", 85));
    const pitch = Math.max(10, Math.min(max, Math.trunc(cmd.pitch)));
    const d = aimDir(yaw, pitch);
    const v = speedPerTick(param(w, "jumpSpeed", 480));
    next = {
      ...c,
      yaw,
      vel: { x: mulQ(d.x, v), y: mulQ(d.y, v), z: mulQ(d.z, v) },
      grounded: false,
      peakY: c.pos.y >> 16,
      safeFall: voxels(param(w, "ignoreFallDamageBelow", 200)),
    };
  } else if (cmd.weaponId === "soda-jetpack") {
    const bursts = Math.max(1, Math.trunc(param(loadWeapons()["soda-jetpack"], "bursts", 8)));
    const lifted = { ...c, yaw };
    next = {
      ...lifted,
      vel: jetBurst(lifted, c.vel),
      grounded: false,
      peakY: c.pos.y >> 16,
      jetFuel: bursts - 1,
    };
  } else {
    if (c.grounded) return null;
    next = { ...c, yaw, umbrella: true, peakY: c.pos.y >> 16 };
  }
  return critters.map((o) => (o.id === c.id ? next : o));
}
