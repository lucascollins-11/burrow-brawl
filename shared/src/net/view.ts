// View protocol types (docs/view-protocol.md). Types only; owner: the architect.
// A view client draws the match and never simulates it.

import type { Crate } from "../match/crates";
import type { MatchConfig } from "../match/match";
import type { TurnState } from "../match/turns";
import type { CritterStatus, SimEvent } from "../sim3d/api";
import type { WeaponInfo } from "../weapons/catalog";
import type { WeaponId } from "../weapons/load";

export interface ViewCritter {
  id: number;
  team: number;
  /** Feet centre, Q16.16 voxels. */
  x: number;
  y: number;
  z: number;
  /** 0..1023, 0 = +x, 256 = +z. */
  yaw: number;
  hp: number;
  status: CritterStatus;
  grounded: boolean;
  /**
   * The utility the critter is busy with, if any: "drill" (Drill Hat), "boots" (in a Spring Boots
   * jump), "jetpack" (Soda Jetpack on) or "umbrella" (Umbrella Glide open) or "rope" (swinging on the Rope Claw) or "gatling" (spraying the Pea Gatling). Absent = nothing.
   */
  act?: "drill" | "boots" | "jetpack" | "umbrella" | "rope" | "gatling";
  /** Where the rope is gripped (Q16.16 voxels, like x/y/z), while `act` is "rope". */
  anchor?: { x: number; y: number; z: number };
  /** Wearing a Bubble Shield (it pops on the next hit). */
  shield?: true;
  /** Frozen by a Snow Globe (draw it in ice); thaws when its turn comes round. */
  frozen?: true;
  /** Under a Feather Charm this turn. */
  feather?: true;
  /** Soda Jetpack bursts left, while `act` is "jetpack". */
  fuel?: number;
}

export interface ViewProjectile {
  id: number;
  ownerId: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  z: number;
  /** Ticks until detonation, or -1 for impact-only weapons. */
  fuseTicks: number;
  /** Facing in yaw steps, for walkers and steered shots (Wind-up Robot, RC Racer, Kite Bomber). */
  heading?: number;
}

/** A puddle on the ground, in whole voxels: a disc of radius `r` centred on (x, y, z). */
export interface ViewZone {
  id: number;
  kind: "fire" | "glue";
  x: number;
  y: number;
  z: number;
  r: number;
  /** Turn ends left before it dries up. */
  turns: number;
}

/** A placed Jelly Mine. Mines are not in `projectiles`. */
export interface ViewMine {
  id: number;
  ownerId: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  z: number;
  /** Past its arming delay: a critter that comes close now sets it off. */
  armed: boolean;
  /** Set off: it explodes in `fuseTicks` ticks. */
  triggered: boolean;
  /** Ticks until it explodes once triggered; -1 while it lies in wait. */
  fuseTicks: number;
}

export interface ViewState {
  tick: number;
  turns: TurnState;
  seaY: number;
  /** Full list in match.start; in `state` only the critters that changed since the last one. */
  critters: ViewCritter[];
  /** Always the full list. Placed mines are in `mines` instead. */
  projectiles: ViewProjectile[];
  /** Placed mines: always the full list; a missing id went off or sank. Absent from older servers. */
  mines?: ViewMine[];
  /** Fire and glue puddles: always the full list; a missing id dried up. Absent from older servers. */
  zones?: ViewZone[];
  /**
   * Shots left per sim team, by weapon id, for weapons with limited ammo; a weapon not listed is
   * unlimited. Always complete. Absent from servers older than ammo.
   */
  ammo?: Record<string, number>[];
  /** Crates on the map: always the full list; a missing id is gone. Absent from older servers. */
  crates?: Crate[];
}

export interface ViewTerrain {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  seaY: number;
  bedrockY: number;
  /** Run-length pairs [count - 1, value], base64. */
  density: string;
  /**
   * Material id per voxel (shared/src/terrain3d/materials.ts), same order and encoding as
   * density. Absent when the map has no built structures (every voxel is natural terrain).
   * Patches carry density only: reset a voxel's material to 0 whenever its solidity flips.
   */
  material?: string;
  /** Detail meshes hung on solid voxels; drop one when its voxel stops being solid. */
  decor?: ViewDecor[];
}

/** See DecorAnchor in shared/src/terrain3d/api.ts. */
export interface ViewDecor {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** 0 = +x, 1 = +z, 2 = -x, 3 = -z, 4 = up, 5 = down. */
  face: number;
  v: number;
}

export type ViewServerMessage =
  | {
      t: "match.start";
      view: true;
      matchId: string;
      config: MatchConfig;
      teamIds: string[];
      terrain: ViewTerrain;
      state: ViewState;
      /** Weapons to offer, in menu order, then sub-munitions (`fireable: false`). */
      weapons: readonly WeaponInfo[];
    }
  | ({ t: "state" } & ViewState)
  | { t: "events"; tick: number; events: SimEvent[] }
  | {
      t: "terrain.patch";
      tick: number;
      x0: number;
      y0: number;
      z0: number;
      sx: number;
      sy: number;
      sz: number;
      density: string;
    };
