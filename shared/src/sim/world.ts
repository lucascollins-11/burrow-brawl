import { toFixed } from "../fixed";
import type { Terrain } from "../terrain";
import { isSolid } from "../terrain";
import { MAX_HEALTH } from "./constants";
import { loadWeapons } from "../weapons/load";
import type { Critter, Inventory, SimState } from "./types";

/** Every team starts with the limited-ammo weapons that are not crate-only. */
export function initialInventory(critters: readonly Critter[]): Inventory[] {
  let teams = 0;
  for (const c of critters) teams = Math.max(teams, c.team + 1);
  const start: Record<string, number> = {};
  for (const w of Object.values(loadWeapons())) {
    if (w.ammo !== null && !w.crateOnly) start[w.id] = w.ammo;
  }
  return Array.from({ length: teams }, () => ({ ...start }));
}

export function createCritter(id: number, team: number, xCell: number, yCell: number): Critter {
  return {
    id,
    team,
    x: toFixed(xCell),
    y: toFixed(yCell),
    vx: 0,
    vy: 0,
    facing: 1,
    hp: MAX_HEALTH,
    status: "alive",
    grounded: false,
    peakY: yCell,
  };
}

export function createWorld(
  terrain: Terrain,
  critters: readonly Critter[],
  waterY: number,
  wind = 0,
): SimState {
  return {
    tick: 0,
    critters,
    terrain,
    waterY,
    projectiles: [],
    nextProjectileId: 1,
    ropes: [],
    drills: [],
    boulders: [],
    crates: [],
    nextEntityId: 1,
    inventory: initialInventory(critters),
    wind,
  };
}

/** Row of the first free cell above the topmost solid cell in column x (spawn helper). Returns -1 if none. */
export function findSurfaceY(t: Terrain, x: number): number {
  for (let y = 0; y < t.height; y++) {
    if (isSolid(t, x, y)) return y - 1;
  }
  return -1;
}
