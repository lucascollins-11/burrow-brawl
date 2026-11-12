// Crates: boxes that drop onto the island between turns. Walking into one takes it: a snack box
// heals, a weapon crate adds one shot of a limited weapon to the team. Crates live in MatchState,
// not the sim: they never block movement or shots, they only sit on the ground, fall when the
// ground under them is blown away, and sink if they reach the soda.

import { CRITTER_HEIGHT, type Critter, type Rng } from "../sim3d/api";
import { cell } from "../sim3d/critter";
import { isSolid } from "../sim3d/terrainOps";
import type { VoxelTerrain } from "../terrain3d/api";

export type CrateKind = "health" | "weapon";

export interface Crate {
  id: number;
  kind: CrateKind;
  /** The weapon a weapon crate holds; "" for a snack box. */
  weaponId: string;
  /** The voxel the crate sits in (the first air voxel above the ground). */
  x: number;
  y: number;
  z: number;
}

/** Health a snack box gives. */
export const CRATE_HEAL = 25;
/** At most this many crates lie on the map at once. */
export const MAX_CRATES = 6;
/** A new turn drops a crate this often: CRATE_CHANCE_NUM in CRATE_CHANCE_DEN. */
export const CRATE_CHANCE_NUM = 1;
export const CRATE_CHANCE_DEN = 2;
/** One crate in this many is a snack box; the rest hold a weapon. */
const HEALTH_ONE_IN = 3;
/** Crates stay this far from the edge of the map. */
const EDGE = 8;
const TRIES = 12;
/** A critter takes a crate within this many voxels sideways. */
const REACH = 2;

/**
 * Pick a spot for a new crate: a random column whose top is dry land. Returns null when no try
 * found land (a nearly sunk map). `weapons` are the ids a weapon crate may hold.
 */
export function dropCrate(
  t: VoxelTerrain,
  seaY: number,
  rng: Rng,
  id: number,
  weapons: readonly string[],
): Crate | null {
  if (t.sizeX <= EDGE * 2 || t.sizeZ <= EDGE * 2) return null;
  for (let i = 0; i < TRIES; i++) {
    const x = EDGE + rng.nextInt(t.sizeX - EDGE * 2);
    const z = EDGE + rng.nextInt(t.sizeZ - EDGE * 2);
    let top = t.sizeY - 2;
    while (top > seaY && !isSolid(t, x, top, z)) top--;
    if (top <= seaY) continue;
    const health = weapons.length === 0 || rng.nextInt(HEALTH_ONE_IN) === 0;
    const weaponId = health ? "" : weapons[rng.nextInt(weapons.length)]!;
    return { id, kind: health ? "health" : "weapon", weaponId, x, y: top + 1, z };
  }
  return null;
}

/**
 * One tick of gravity: a crate with nothing under it falls one voxel; one buried by a landslide
 * of its own making cannot happen (terrain only ever loses voxels). Crates that reach the soda
 * are returned in `lost`.
 */
export function settleCrates(
  t: VoxelTerrain,
  seaY: number,
  crates: readonly Crate[],
): { crates: Crate[]; lost: Crate[] } {
  const kept: Crate[] = [];
  const lost: Crate[] = [];
  for (const c of crates) {
    const falls = c.y > 0 && !isSolid(t, c.x, c.y - 1, c.z);
    const next = falls ? { ...c, y: c.y - 1 } : c;
    if (next.y <= seaY) lost.push(next);
    else kept.push(next);
  }
  return { crates: kept, lost };
}

/** True when a living critter's body touches the crate. */
export function touches(k: Critter, c: Crate): boolean {
  if (k.status !== "alive") return false;
  const dy = c.y - cell(k.pos.y);
  return (
    Math.abs(cell(k.pos.x) - c.x) <= REACH &&
    Math.abs(cell(k.pos.z) - c.z) <= REACH &&
    dy >= -1 &&
    dy <= CRITTER_HEIGHT
  );
}

/** Who takes what this tick: the lowest critter id wins a crate two critters touch. */
export function collectCrates(
  crates: readonly Crate[],
  critters: readonly Critter[],
): { crates: Crate[]; taken: { crate: Crate; critterId: number }[] } {
  const kept: Crate[] = [];
  const taken: { crate: Crate; critterId: number }[] = [];
  const order = [...critters].sort((a, b) => a.id - b.id);
  for (const c of crates) {
    const who = order.find((k) => touches(k, c));
    if (who) taken.push({ crate: c, critterId: who.id });
    else kept.push(c);
  }
  return { crates: kept, taken };
}
