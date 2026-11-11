// View protocol types (docs/view-protocol.md). Types only; owner: the architect.
// A view client draws the match and never simulates it.

import type { MatchConfig } from "../match/match";
import type { TurnState } from "../match/turns";
import type { CritterStatus, SimEvent } from "../sim3d/api";
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
}

export interface ViewState {
  tick: number;
  turns: TurnState;
  seaY: number;
  /** Full list in match.start; in `state` only the critters that changed since the last one. */
  critters: ViewCritter[];
  /** Always the full list. */
  projectiles: ViewProjectile[];
}

export interface ViewTerrain {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  seaY: number;
  bedrockY: number;
  /** Run-length pairs [count - 1, value], base64. */
  density: string;
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
