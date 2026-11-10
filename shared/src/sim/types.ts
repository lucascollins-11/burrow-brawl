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

/** Rope Claw: a hook in flight, or attached to terrain with the critter swinging on it. One per critter. */
export interface Rope {
  readonly critterId: number;
  readonly phase: "flying" | "attached";
  /** Hook position (flying) or anchor point (attached), Q16.16 cells. */
  readonly x: Fixed;
  readonly y: Fixed;
  /** Unit flight direction while flying, Q16.16. */
  readonly dx: Fixed;
  readonly dy: Fixed;
  /** Cells flown so far. */
  readonly travelled: number;
  /** Rope length once attached, in raw Q16.16 cell units. */
  readonly length: number;
}

/** Drill Hat: the critter digs a tunnel while this exists. */
export interface Drill {
  readonly critterId: number;
  readonly ticksLeft: number;
  readonly mode: "down" | "side";
}

/** Boulder of Doom: rolls along the ground, flattening terrain and crushing critters it touches. */
export interface Boulder {
  readonly id: number;
  readonly ownerId: number;
  readonly x: Fixed;
  readonly y: Fixed;
  readonly dir: -1 | 1;
  readonly age: number;
  /** Critter ids already crushed by this boulder (each is hit once). */
  readonly hit: readonly number[];
}

export type CrateKind = "health" | "weapon";

/** Supply crate: falls, rests on the ground, and is collected when a critter touches it. */
export interface Crate {
  readonly id: number;
  /** Centre column (cells, integer) and Q16.16 y of the crate's centre. */
  readonly x: number;
  readonly y: Fixed;
  readonly vy: Fixed;
  readonly kind: CrateKind;
  /** Weapon granted (kind "weapon"). */
  readonly weaponId: WeaponId | null;
  readonly grounded: boolean;
}

/** Per team: weapon id -> uses left. Weapons with unlimited ammo are not listed. */
export type Inventory = Readonly<Record<string, number>>;

export interface FireCommand {
  readonly weaponId: WeaponId;
  /** Aim direction in whole degrees: 0 = right, 90 = up, 180 = left. */
  readonly angleDeg: number;
  /** Charge from 0 to 100 percent of the weapon's max speed. */
  readonly power: number;
  /** Fuse for timed weapons, clamped to the weapon's range. */
  readonly fuseSeconds?: number;
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
  readonly ropes: readonly Rope[];
  readonly drills: readonly Drill[];
  readonly boulders: readonly Boulder[];
  readonly crates: readonly Crate[];
  /** Ids for boulders and crates. */
  readonly nextEntityId: number;
  /** Per team index: limited-ammo weapons and how many uses are left. */
  readonly inventory: readonly Inventory[];
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
      /** 0 when the weapon makes no projectile. */
      readonly projectileId: number;
      readonly weaponId: WeaponId;
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
  /** Rope Claw and Drill Hat milestones (for sounds and effects). */
  | {
      readonly type: "gadget";
      readonly critterId: number;
      readonly weaponId: "rope-claw" | "drill-hat";
      readonly phase: "fired" | "attached" | "released" | "ended";
    }
  | {
      readonly type: "crateDropped";
      readonly crateId: number;
      readonly x: number;
      readonly kind: CrateKind;
    }
  | {
      readonly type: "crateCollected";
      readonly crateId: number;
      readonly critterId: number;
      readonly kind: CrateKind;
      readonly weaponId: WeaponId | null;
      /** Health restored (kind "health"). */
      readonly amount: number;
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
