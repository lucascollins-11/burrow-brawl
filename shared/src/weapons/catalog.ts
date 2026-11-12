// The weapon catalogue a client shows (docs/view-protocol.md, match.start `weapons`): every weapon
// the sim can fire right now, plus the sub-munitions it may draw in flight. Built from the weapon
// JSON, so a client never hardcodes the list.

import { loadWeapons, type WeaponId } from "./load";

/** What the client must collect before sending `fire`, or offer after it. */
export type WeaponNeed =
  /** A target voxel (`fire.target`), picked on the map. */
  | "target"
  /** A `trigger` command while the shot is in flight. */
  | "trigger"
  /** A fuse (`fire.fuseSeconds`), 1..5. */
  | "fuse"
  /** A power (`fire.power`), charged by holding fire. */
  | "charge";

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  description: string;
  needs: WeaponNeed[];
  /** Uses per team per match, or null for unlimited. */
  ammo: number | null;
  /** False for sub-munitions: listed only so a client can name and draw them. */
  fireable: boolean;
}

/** Weapons the sim implements and a player can fire, in menu order. */
export const FIREABLE_WEAPONS: readonly WeaponId[] = [
  "acorn-mortar",
  "pinecone-popper",
  "fizz-grenade",
  "hopper-ball",
  "beehive-strike",
];

/** Weapons that pop in flight on a `trigger` command. */
export const TRIGGERED_WEAPONS: readonly WeaponId[] = ["pinecone-popper"];

let cached: WeaponInfo[] | null = null;

/** The catalogue: fireable weapons in menu order, then every sub-munition. Same array every call. */
export function weaponCatalog(): readonly WeaponInfo[] {
  if (cached) return cached;
  const reg = loadWeapons();
  const subs = (Object.keys(reg) as WeaponId[]).filter((id) => reg[id].fireable === false).sort();
  cached = [...FIREABLE_WEAPONS, ...subs].map((id) => {
    const w = reg[id];
    const needs: WeaponNeed[] = [];
    if (w.targeting === "click-point" || w.targeting === "placement") needs.push("target");
    if (TRIGGERED_WEAPONS.includes(id)) needs.push("trigger");
    const fuse = w.params.fuseSeconds as { min?: unknown; max?: unknown } | undefined;
    if (fuse && typeof fuse === "object" && fuse.min !== fuse.max) needs.push("fuse");
    if (w.targeting === "aim-power" || w.targeting === "aim-angle-power") needs.push("charge");
    return {
      id,
      name: w.name,
      description: w.description,
      needs,
      ammo: w.ammo,
      fireable: w.fireable !== false,
    };
  });
  return cached;
}
