import type { Fixed } from "../fixed";
import type { Terrain } from "../terrain";

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

export interface SimState {
  readonly tick: number;
  readonly critters: readonly Critter[];
  /** Mutable shared mask. Explosions (S4) are the only thing that changes it. */
  readonly terrain: Terrain;
  /** Feet below this cell row drown. */
  readonly waterY: number;
}

export interface CritterInput {
  readonly critterId: number;
  /** -1 left, 0 none, 1 right. */
  readonly move: -1 | 0 | 1;
  /** Forward jump. Only works while grounded. */
  readonly jump?: boolean;
  /** Backward flip. Only works while grounded. */
  readonly backflip?: boolean;
}

export type SimEvent =
  | { readonly type: "jumped"; readonly critterId: number; readonly backflip: boolean }
  | { readonly type: "landed"; readonly critterId: number; readonly fallDistance: number }
  | {
      readonly type: "damage";
      readonly critterId: number;
      readonly amount: number;
      readonly cause: "fall";
    }
  | { readonly type: "died"; readonly critterId: number; readonly cause: "fall" | "water" };

/** Injected randomness. Opus's seeded PRNG (O2) will implement this; the sim never touches Math.random. */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}
