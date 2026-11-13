// Utilities that act at once and leave no projectile: the Build Block (a box of new terrain at a
// target), the Bubble Shield (absorbs the next hit) and the Cookie Snack (heals self or a
// teammate beside you). None ends the turn. projectile.ts routes fired commands here.

import { FIXED_ONE } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import type { Critter, FireCommand, SimEvent } from "./api";
import { CRITTER_HEIGHT } from "./api";
import { LENGTH_DEN, LENGTH_NUM, MAX_HEALTH } from "./constants";
import { FOOTPRINT, cell } from "./critter";
import { applyEdit } from "./terrainOps";
import { length } from "./vec3";

export const UTILITY_WEAPONS = [
  "build-block",
  "bubble-shield",
  "cookie-snack",
  "feather-charm",
] as const;
export type UtilityWeapon = (typeof UTILITY_WEAPONS)[number];

export function isUtilityWeapon(id: string): id is UtilityWeapon {
  return (UTILITY_WEAPONS as readonly string[]).includes(id);
}

function param(w: WeaponData, key: string, fallback: number): number {
  const v = w.params[key];
  return typeof v === "number" ? v : fallback;
}

/** 2D length -> whole voxels. */
const voxels = (units: number): number => Math.floor((units * LENGTH_NUM) / LENGTH_DEN);

/**
 * The block a Build Block would place for a target: `blockSize` square, `blockHeight` tall,
 * resting with its base on the target voxel. Inclusive corners.
 */
export function blockBox(target: { x: number; y: number; z: number }): {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
} {
  const w = loadWeapons()["build-block"];
  const s = Math.max(2, voxels(param(w, "blockSize", 20)));
  const h = Math.max(1, voxels(param(w, "blockHeight", 14)));
  const x0 = Math.trunc(target.x) - (s >> 1);
  const z0 = Math.trunc(target.z) - (s >> 1);
  const y0 = Math.trunc(target.y);
  return { x0, y0, z0, x1: x0 + s - 1, y1: y0 + h - 1, z1: z0 + s - 1 };
}

/** True if any voxel of a living critter's body is inside the box. */
function boxHitsCritter(critters: readonly Critter[], b: ReturnType<typeof blockBox>): boolean {
  return critters.some((o) => {
    if (o.status !== "alive") return false;
    const x = cell(o.pos.x);
    const y = cell(o.pos.y);
    const z = cell(o.pos.z);
    if (y + CRITTER_HEIGHT - 1 < b.y0 || y > b.y1) return false;
    return FOOTPRINT.some(
      ([dx, dz]) => x + dx >= b.x0 && x + dx <= b.x1 && z + dz >= b.z0 && z + dz <= b.z1,
    );
  });
}

/**
 * Fire a utility. Returns the critters after it, or null if refused (nothing happened, nothing
 * pushed): a block with no target, out of range, off the grid or onto a critter; a second shield.
 */
export function fireUtility(
  t: VoxelTerrain,
  critters: readonly Critter[],
  c: Critter,
  cmd: FireCommand & { weaponId: UtilityWeapon },
  events: SimEvent[],
): Critter[] | null {
  if (cmd.weaponId === "build-block") {
    const g = cmd.target;
    if (!g) return null;
    const range = voxels(param(loadWeapons()["build-block"], "maxRange", 250));
    const d = {
      x: (Math.trunc(g.x) - cell(c.pos.x)) * FIXED_ONE,
      y: (Math.trunc(g.y) - cell(c.pos.y)) * FIXED_ONE,
      z: (Math.trunc(g.z) - cell(c.pos.z)) * FIXED_ONE,
    };
    if (length(d) > range * FIXED_ONE) return null;
    const b = blockBox(g);
    if (b.x0 < 0 || b.z0 < 0 || b.y0 < t.bedrockY) return null;
    if (b.x1 >= t.sizeX || b.z1 >= t.sizeZ || b.y1 >= t.sizeY - 1) return null;
    if (boxHitsCritter(critters, b)) return null;
    applyEdit(t, { op: "box", ...b });
    return [...critters];
  }
  if (cmd.weaponId === "feather-charm") {
    if (c.feather) return null;
    return critters.map((o) => (o.id === c.id ? { ...o, feather: true as const } : o));
  }
  if (cmd.weaponId === "bubble-shield") {
    if (c.shield) return null;
    return critters.map((o) => (o.id === c.id ? { ...o, shield: true as const } : o));
  }
  // Cookie Snack: the most hurt of self and living teammates within reach (ties: self, then
  // the first in critter order).
  const reach = voxels(param(loadWeapons()["cookie-snack"], "reach", 30)) * FIXED_ONE;
  let who = c;
  for (const o of critters) {
    if (o.status !== "alive" || o.team !== c.team || o.id === c.id) continue;
    const d = { x: o.pos.x - c.pos.x, y: o.pos.y - c.pos.y, z: o.pos.z - c.pos.z };
    if (length(d) > reach) continue;
    if (o.hp < who.hp) who = o;
  }
  const heal = Math.trunc(param(loadWeapons()["cookie-snack"], "heal", 25));
  const amount = Math.max(0, Math.min(heal, MAX_HEALTH - who.hp));
  events.push({ type: "healed", critterId: who.id, amount });
  return critters.map((o) => (o.id === who.id ? { ...o, hp: o.hp + amount } : o));
}

/** If `c` wears a Bubble Shield, pop it (pushing `shieldPopped`) and say so. */
export function popShield(c: Critter, events: SimEvent[]): boolean {
  if (!c.shield) return false;
  events.push({ type: "shieldPopped", critterId: c.id });
  return true;
}

/** The critter without its shield. */
export function dropShield(c: Critter): Critter {
  const { shield: _s, ...rest } = c;
  void _s;
  return rest;
}
