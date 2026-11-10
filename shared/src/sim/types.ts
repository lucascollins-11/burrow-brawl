import type { Fixed } from "../fixed";
import type { Terrain } from "../terrain";
import type { WeaponId } from "../weapons/load";

export type CritterStatus = "alive" | "dead" | "drowned";

export interface Critter {
  readonly id: number;
  readonly team: number;
  /** Feet position, Q16.16 cells (mask space, +y down). */
  readonly x: Fixed;
  readonly y: Fixed;
  readonly vx: Fixed;
  readonly vy: Fixed;
  /** -1 faces left, 1 faces right. */
  readonly facing: -1 | 1;
  readonly hp: number;
  readonly status: CritterStatus;
  readonly grounded: boolean;
  /** Highest point (smallest y, in cells) reached since leaving the ground; drives fall damage. */
  readonly peakY: number;
}

export type ProjectileWeaponId = Extract<WeaponId, "acorn-mortar" | "fizz-grenade">;

export interface Projectile {
  readonly id: number;
  readonly ownerId: number;
  readonly weaponId: ProjectileWeaponId;
  /** Position and velocity, Q16.16 cells and cells per tick (mask space, +y down). */
  readonly x: Fixed;
  readonly y: Fixed;
  readonly vx: Fixed;
  readonly vy: Fixed;
  readonly age: number;
  /** Ticks until detonation, or -1 for impact-only weapons. */
  readonly fuseTicks: number;
  readonly bounces: number;
  /** Grenade that has stopped bouncing and sits on the ground. */
  readonly resting: boolean;
}

export interface FireCommand {
  readonly weaponId: WeaponId;
  /** Aim direction in whole degrees: 0 = right, 90 = up, 180 = left. */
  readonly angleDeg: number;
  /** Charge from 0 to 100 percent of the weapon's max speed. */
  readonly power: number;
  /** Fuse for timed weapons, clamped to the weapon's range. */
  readonly fuseSeconds?: number;
  /** Target cell for click-point weapons (teleport). Whole cells in mask space, +y down. */
  readonly target?: { readonly x: number; readonly y: number };
}

export interface SimState {
  readonly tick: number;
  readonly critters: readonly Critter[];
  /** Mutable shared mask. Explosions (S4) are the only thing that changes it. */
  readonly terrain: Terrain;
  /** Feet below this cell row drown. */
  readonly waterY: number;
  readonly projectiles: readonly Projectile[];
  readonly nextProjectileId: number;
  /** Wind strength from -100 (full left) to 100 (full right). */
  readonly wind: number;
}

export interface CritterInput {
  readonly critterId: number;
  /** -1 left, 0 none, 1 right. */
  readonly move: -1 | 0 | 1;
  /** Forward jump. Only works while grounded. */
  readonly jump?: boolean;
  /** Backward flip. Only works while grounded. */
  readonly backflip?: boolean;
  /** Fire a weapon this tick. Ignored for dead critters and unsupported weapons. */
  readonly fire?: FireCommand;
}

export type SimEvent =
  | { readonly type: "jumped"; readonly critterId: number; readonly backflip: boolean }
  | { readonly type: "landed"; readonly critterId: number; readonly fallDistance: number }
  | {
      readonly type: "damage";
      readonly critterId: number;
      readonly amount: number;
      readonly cause: "fall" | "explosion";
    }
  | {
      readonly type: "died";
      readonly critterId: number;
      readonly cause: "fall" | "water" | "explosion";
    }
  | {
      readonly type: "fired";
      readonly critterId: number;
      readonly projectileId: number;
      readonly weaponId: ProjectileWeaponId;
    }
  | { readonly type: "bounced"; readonly projectileId: number }
  /** Terrain was carved by a circle at (x, y). Replays and clients re-apply this to their mask. */
  | {
      readonly type: "explosion";
      readonly projectileId: number;
      readonly weaponId: ProjectileWeaponId;
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly cellsRemoved: number;
    }
  | { readonly type: "projectileLost"; readonly projectileId: number }
  /** An instant weapon sent the critter somewhere new. Cells, whole numbers. */
  | {
      readonly type: "teleported";
      readonly critterId: number;
      readonly x: number;
      readonly y: number;
    }
  /** Spring Boots launched the critter. */
  | { readonly type: "springJumped"; readonly critterId: number }
  /** The weapon's turn is over (endsTurn in its data). Clients and the turn manager act on this. */
  | { readonly type: "turnEnded"; readonly critterId: number; readonly weaponId: WeaponId };

/** Injected randomness. Opus's seeded PRNG (O2) will implement this; the sim never touches Math.random. */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}
