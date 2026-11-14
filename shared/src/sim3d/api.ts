// sim3d contract. Types and signatures only: the implementation lives next to this file
// (owner: sim3d). Changes to this file go through the architect.
//
// Rules:
// - Positions and velocities are Q16.16 in voxel units (see ../fixed), +y up. Positions fit in
//   int32 because the largest grid is 384 voxels.
// - No floats, no Math.random, no Date. Angles are integers looked up in the sine table.
// - Multiplying two Q16.16 values can exceed 2^53 as a JS number. Every multiply, dot product
//   and length goes through helpers that are property-tested against a BigInt reference.
// - There is no rigid-body solver. Critters use a kinematic controller; projectiles are points
//   marched voxel by voxel. Collision reads terrain3d's binary solid test, never the mesh.
// - The sim never sees the camera. Clients convert camera-relative input into the integer
//   headings below before sending.
// - stepWorld mutates the terrain in place (through terrain3d.applyEdit) and returns new
//   immutable critter and projectile records, like the 2D sim.

import type { Fixed } from "../fixed";
import type { TerrainEdit, VoxelTerrain } from "../terrain3d/api";
import type { WeaponId } from "../weapons/load";

/** A full turn is YAW_STEPS units: 0 = +x, YAW_STEPS / 4 = +z. */
export const YAW_STEPS = 1024;
/** Pitch in whole degrees: 0 = level, positive = up. */
export const PITCH_MIN = -89;
export const PITCH_MAX = 89;

/** Critter body in voxels: feet at (x, y, z), a vertical cylinder checked voxel by voxel. */
export const CRITTER_HEIGHT = 6;
/** Radius in half-voxels (3 = 1.5 voxels). The footprint is a fixed list of column offsets. */
export const CRITTER_RADIUS_HALF = 3;
/** Walking climbs at most this many voxels per step and snaps down at most this many. */
export const MAX_STEP_UP = 1;
export const MAX_STEP_DOWN = 2;

export interface Vec3 {
  readonly x: Fixed;
  readonly y: Fixed;
  readonly z: Fixed;
}

export type CritterStatus = "alive" | "dead" | "drowned";

export interface Critter {
  readonly id: number;
  readonly team: number;
  /** Feet centre. */
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** Facing heading, 0..YAW_STEPS-1. */
  readonly yaw: number;
  readonly hp: number;
  readonly status: CritterStatus;
  readonly grounded: boolean;
  /** Highest voxel y reached since leaving the ground; drives fall damage. */
  readonly peakY: number;
  /** Ticks of Drill Hat tunnelling left. Absent (never 0) when the critter is not drilling. */
  readonly drillTicks?: number;
  /** Drill velocity per tick (Q16.16 voxels) while drilling: level along the yaw, or straight down. */
  readonly drillDir?: Vec3;
  /** Spring Boots: voxels of fall forgiven on the next landing. Absent when not wearing them. */
  readonly safeFall?: number;
  /** Soda Jetpack: bursts left; each jump input in the air spends one. Absent when not worn. */
  readonly jetFuel?: number;
  /** Umbrella Glide: open while airborne (slow fall, steerable, no fall damage). */
  readonly umbrella?: true;
  /**
   * Rope Claw: swinging on a rope from `anchor` (Q16.16), at most `len` long, for `ticks` more.
   * The rope reels in by `reel` per tick until it is `reelTo` long.
   */
  readonly rope?: {
    readonly anchor: Vec3;
    readonly len: number;
    readonly reelTo: number;
    readonly reel: number;
    readonly ticks: number;
  };
  /** Bubble Shield: the next explosion or punch on this critter is absorbed. */
  readonly shield?: true;
  /** Snow Globe: frozen solid; takes no input, and its next turn is skipped (which thaws it). */
  readonly frozen?: true;
  /** Pea Gatling: spraying for `ticks` more at `pitch`; the walk keys sweep the facing. */
  readonly gatling?: { readonly ticks: number; readonly pitch: number };
  /** Feather Charm: this critter and the shots it fires fall at half gravity until the turn ends. */
  readonly feather?: true;
}

export interface Projectile {
  readonly id: number;
  readonly ownerId: number;
  readonly weaponId: WeaponId;
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly age: number;
  /** Ticks until detonation, or -1 for impact-only weapons. */
  readonly fuseTicks: number;
  readonly bounces: number;
  readonly resting: boolean;
  /** Walkers and steered shots (Wind-up Robot, RC Racer, Kite Bomber): heading in yaw steps. */
  readonly heading?: number;
  /** Fired under a Feather Charm: falls at half gravity. */
  readonly light?: true;
  /** Homing target voxel (Paper Plane Seeker). Absent for everything else. */
  readonly target?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface FireCommand {
  readonly weaponId: WeaponId;
  /** 0..YAW_STEPS-1. */
  readonly yaw: number;
  /** PITCH_MIN..PITCH_MAX. */
  readonly pitch: number;
  /** 0..100 percent of the weapon's max speed. */
  readonly power: number;
  readonly fuseSeconds?: number;
  /** Target voxel for placed or called-in weapons. */
  readonly target?: { readonly x: number; readonly y: number; readonly z: number };
}

/** One critter's input for one tick. The match layer builds this from relayed commands. */
export interface CritterInput {
  readonly critterId: number;
  /** Walk heading 0..YAW_STEPS-1, or -1 to stand still. Held until changed. */
  readonly moveYaw: number;
  readonly jump?: boolean;
  readonly backflip?: boolean;
  readonly fire?: FireCommand;
  /** Pop this critter's triggerable shots in flight (the Pinecone Popper's mid-air burst). */
  readonly trigger?: boolean;
}

export interface SimState {
  readonly tick: number;
  readonly critters: readonly Critter[];
  readonly projectiles: readonly Projectile[];
  readonly nextProjectileId: number;
  /** Shared and mutated in place. Hashed through terrain3d.hash, snapshotted as recipe + edits. */
  readonly terrain: VoxelTerrain;
  /**
   * Wind this turn as a horizontal vector, each component -100..100. Rolled by the turn
   * controller as a heading and a strength, stored as components so the sim does no trig.
   */
  readonly windX: number;
  readonly windZ: number;
  /** Soda surface row for the sim (starts at terrain.seaY, rises in sudden death). */
  readonly seaY: number;
  /** Fire and glue puddles on the map. Absent (never empty) when there are none. */
  readonly zones?: readonly Zone[];
}

/**
 * A puddle on the ground: fire hurts critters standing in it as each turn ends; glue stops
 * critters in it walking or jumping. Lasts `turns` more turn ends.
 */
export interface Zone {
  readonly id: number;
  readonly kind: "fire" | "glue";
  /** Centre voxel, on the ground. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radius in voxels. */
  readonly r: number;
  readonly turns: number;
}

export type DamageCause = "fall" | "explosion" | "hit" | "water" | "fire";

export type SimEvent =
  | { readonly type: "jumped"; readonly critterId: number; readonly backflip: boolean }
  | { readonly type: "landed"; readonly critterId: number; readonly fallDistance: number }
  | {
      readonly type: "damage";
      readonly critterId: number;
      readonly amount: number;
      readonly cause: DamageCause;
    }
  | { readonly type: "died"; readonly critterId: number; readonly cause: DamageCause }
  | {
      readonly type: "fired";
      readonly critterId: number;
      /** The first projectile launched, or -1 for weapons that launch none (hitscan). */
      readonly projectileId: number;
      readonly weaponId: WeaponId;
    }
  | { readonly type: "bounced"; readonly projectileId: number }
  /**
   * One hitscan pellet's line, from the muzzle to where it stopped (Q16.16 voxels). Sent after
   * its `fired` (whose projectileId is -1) and before the `explosion` at the hit voxel, if any.
   */
  | {
      readonly type: "tracer";
      readonly critterId: number;
      readonly weaponId: WeaponId;
      readonly from: Vec3;
      readonly to: Vec3;
      readonly hit: boolean;
    }
  /** A critter came close to an armed mine; it blows a moment later. */
  | { readonly type: "mineTriggered"; readonly projectileId: number }
  /** A melee swing landed at `at` (Q16.16 voxels) and struck `hits` critters; follows `fired`. */
  | {
      readonly type: "punch";
      readonly critterId: number;
      readonly at: Vec3;
      readonly hits: number;
    }
  /** A critter burrowed from `from` to `to` (feet, Q16.16 voxels); follows `fired`. */
  | {
      readonly type: "teleported";
      readonly critterId: number;
      readonly from: Vec3;
      readonly to: Vec3;
    }
  /** A blast at a voxel. The terrain change itself is `edit`, already applied. */
  | {
      readonly type: "explosion";
      readonly projectileId: number;
      readonly weaponId: WeaponId;
      readonly edit: TerrainEdit;
    }
  | { readonly type: "projectileLost"; readonly projectileId: number }
  /** A crate landed on the map at voxel (x, y, z). Crate events come from the match, not the sim. */
  | {
      readonly type: "crateDropped";
      readonly crateId: number;
      readonly kind: "health" | "weapon";
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** A critter took a crate: `amount` health for a snack box, or shots of `weaponId`. */
  | {
      readonly type: "crateTaken";
      readonly crateId: number;
      readonly critterId: number;
      readonly kind: "health" | "weapon";
      readonly weaponId: string;
      readonly amount: number;
    }
  /** A Cookie Snack: `critterId` gained `amount` health (0 when already full). */
  | { readonly type: "healed"; readonly critterId: number; readonly amount: number }
  /** A Snow Globe froze `critterId`. */
  | { readonly type: "frozen"; readonly critterId: number }
  /** A frozen critter's turn came round: it was skipped and the critter thawed. */
  | { readonly type: "thawed"; readonly critterId: number }
  /** A Bubble Shield took a hit for `critterId` and popped. */
  | { readonly type: "shieldPopped"; readonly critterId: number }
  /** A crate sank into the soda. */
  | { readonly type: "crateLost"; readonly crateId: number };

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}

/** Injected randomness (the match PRNG). */
export interface Rng {
  nextInt(maxExclusive: number): number;
}

/** What sim3d exports. The match layer (createMatch / stepMatch / hashMatch) is its only caller. */
export interface Sim3dApi {
  createWorld(terrain: VoxelTerrain, critters: readonly Critter[]): SimState;
  createCritter(id: number, team: number, x: number, y: number, z: number, hp: number): Critter;
  /** Advance one 60 Hz tick. Critters and projectiles are stepped in array order. */
  stepWorld(state: SimState, inputs: readonly CritterInput[], rng: Rng): StepResult;
  /** True when no projectile is live and every living critter is grounded and still. */
  isSettled(state: SimState): boolean;
  /** True if a critter standing with feet at voxel (x, y, z) would overlap solid terrain. */
  bodyBlocked(t: VoxelTerrain, x: number, y: number, z: number): boolean;
}
