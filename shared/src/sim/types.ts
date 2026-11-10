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

/** Weapons a critter throws or shoots as a projectile (the ones `spawnProjectile` makes). */
export type ThrownWeaponId = Extract<WeaponId, "acorn-mortar" | "fizz-grenade">;
/** Anything that flies as a Projectile: thrown weapons and the bombs of a Beehive Strike. */
export type ProjectileWeaponId = ThrownWeaponId | Extract<WeaponId, "beehive-strike">;
/** Weapons that carve a crater and hurt with falloff (see `explode`). */
export type ExplosiveWeaponId = ProjectileWeaponId | Extract<WeaponId, "jelly-mine">;

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
  /** Clicked point in mask cells, for click-targeted weapons (Beehive Strike). */
  readonly target?: { readonly x: number; readonly y: number };
}

/** A placed Jelly Mine. Position is whole mask cells (feet of the placer). */
export interface Mine {
  readonly id: number;
  readonly ownerId: number;
  readonly x: number;
  readonly y: number;
  /** Ticks since placement; the mine is armed once this reaches the weapon's arm time. */
  readonly age: number;
}

/** A Beehive Strike in progress: bombs are released one at a time above the target. */
export interface Strike {
  readonly id: number;
  readonly ownerId: number;
  readonly x: number;
  readonly y: number;
  readonly dropped: number;
  /** Ticks until the next bomb is released. */
  readonly nextIn: number;
}

/** Pepper Shotgun shots still owed to a critter this turn (cleared when the turn changes). */
export interface Burst {
  readonly critterId: number;
  readonly left: number;
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
  readonly mines: readonly Mine[];
  readonly strikes: readonly Strike[];
  readonly burst: Burst | null;
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
      /** 0 when the weapon makes no projectile (shotgun, punch, mine, strike). */
      readonly projectileId: number;
      readonly weaponId: WeaponId;
    }
  | { readonly type: "bounced"; readonly projectileId: number }
  /** Terrain was carved by a circle at (x, y). Replays and clients re-apply this to their mask. */
  | {
      readonly type: "explosion";
      readonly projectileId: number;
      readonly weaponId: ExplosiveWeaponId;
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly cellsRemoved: number;
    }
  | { readonly type: "projectileLost"; readonly projectileId: number }
  /** One Pepper Shotgun blast along (x0, y0) to (x1, y1), in mask cells. */
  | {
      readonly type: "shot";
      readonly critterId: number;
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly hitCritterId: number | null;
      /** Radius of the tunnel carved where the shot hit terrain (0 if none). */
      readonly carved: number;
    }
  | {
      readonly type: "punched";
      readonly critterId: number;
      readonly targetId: number | null;
    }
  | {
      readonly type: "minePlaced";
      readonly critterId: number;
      readonly mineId: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "mineArmed"; readonly mineId: number }
  | {
      readonly type: "strikeCalled";
      readonly critterId: number;
      readonly x: number;
      readonly y: number;
    };

/** Injected randomness. Opus's seeded PRNG (O2) will implement this; the sim never touches Math.random. */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}
