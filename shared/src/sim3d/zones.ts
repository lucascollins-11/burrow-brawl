// Puddles on the ground (Hot Sauce Flask fire, Glue Puddle glue) and the turn-end upkeep of
// turn-long statuses. Zones live in SimState.zones; the match calls zonesTurnEnd once per turn
// change. Puddles are flat discs: a critter is in one when its feet are within `r` across and
// a few voxels up or down.

import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import type { Critter, Projectile, SimEvent, SimState, Zone } from "./api";
import { LENGTH_DEN, LENGTH_NUM } from "./constants";
import { cell } from "./critter";
import { isSolid } from "./terrainOps";
import type { VoxelTerrain } from "../terrain3d/api";

/** Feet this far below or above a puddle's centre row still count as standing in it. */
const ZONE_REACH_Y = 3;

function param(w: WeaponData, key: string, fallback: number): number {
  const v = w.params[key];
  return typeof v === "number" ? v : fallback;
}

export function inZone(zone: Zone, c: Critter): boolean {
  if (c.status !== "alive") return false;
  const dx = cell(c.pos.x) - zone.x;
  const dz = cell(c.pos.z) - zone.z;
  const dy = cell(c.pos.y) - zone.y;
  return dx * dx + dz * dz <= zone.r * zone.r && dy >= -ZONE_REACH_Y && dy <= ZONE_REACH_Y;
}

/** True if the critter stands in a glue puddle. */
export function inGlue(zones: readonly Zone[] | undefined, c: Critter): boolean {
  return !!zones?.some((z) => z.kind === "glue" && inZone(z, c));
}

/** Puddles run down this far to find the ground under a blast. */
const ZONE_DROP = 24;

/**
 * The puddle a projectile leaves where it blasts, if its weapon makes one: on the ground under
 * the blast (a splash on a critter's head lands at its feet). None over a drop or the sea.
 */
export function zoneFrom(
  t: VoxelTerrain,
  p: Projectile,
  x: number,
  blastY: number,
  z: number,
): Zone | null {
  const w = loadWeapons()[p.weaponId];
  const kind = w.params.zone;
  if (kind !== "fire" && kind !== "glue") return null;
  let y = blastY;
  while (y > blastY - ZONE_DROP && y > 0 && !isSolid(t, x, y - 1, z)) y--;
  if (!isSolid(t, x, y - 1, z)) return null;
  return {
    id: p.id,
    kind,
    x,
    y,
    z,
    r: Math.max(1, Math.floor((param(w, "zoneRadius", 40) * LENGTH_NUM) / LENGTH_DEN)),
    turns: Math.max(1, Math.trunc(param(w, "zoneTurns", 3))),
  };
}

/** Fire damage per turn end for a fire puddle. */
function fireDamage(): number {
  return Math.trunc(param(loadWeapons()["hot-sauce-flask"], "zoneDamage", 10));
}

/**
 * A turn ended: fire puddles scorch everyone standing in them, every puddle loses a turn (and
 * dries up at zero), and Feather Charms wear off. Pushes `damage` (cause "fire") and `died`.
 */
export function zonesTurnEnd(state: SimState, events: SimEvent[]): SimState {
  const zones = state.zones ?? [];
  const hurt = fireDamage();
  let changed = false;
  const critters = state.critters.map((c) => {
    let out = c;
    if (out.feather) {
      const { feather: _f, ...rest } = out;
      void _f;
      out = rest;
    }
    const fires = zones.filter((z) => z.kind === "fire" && inZone(z, c)).length;
    if (fires > 0 && c.status === "alive") {
      const dealt = Math.min(c.hp, hurt * fires);
      if (dealt > 0) {
        events.push({ type: "damage", critterId: c.id, amount: dealt, cause: "fire" });
        const hp = c.hp - dealt;
        if (hp <= 0) events.push({ type: "died", critterId: c.id, cause: "fire" });
        out = { ...out, hp, status: hp <= 0 ? "dead" : out.status };
      }
    }
    if (out !== c) changed = true;
    return out;
  });
  const left = zones.map((z) => ({ ...z, turns: z.turns - 1 })).filter((z) => z.turns > 0);
  if (!changed && zones.length === 0) return state;
  const { zones: _z, ...rest } = state;
  void _z;
  return { ...rest, critters, ...(left.length ? { zones: left } : {}) };
}
