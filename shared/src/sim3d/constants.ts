// sim3d tuning, in voxels and ticks (Q16.16 where noted). Body sizes and step limits are in the
// contract (./api); everything here is implementation tuning and may change in balance passes.
//
// The 2D sim measured in cells with a 20-cell critter; a 3D critter is 6 voxels, so lengths,
// speeds and accelerations carry over at LENGTH_NUM / LENGTH_DEN = 3/10. Jump height in body
// heights, shot range in map widths and blast size in body heights all stay as they felt in 2D.

import { FIXED_ONE } from "../fixed";

/** Fixed step: the whole sim advances in 1/60 s ticks. */
export const TICK_RATE = 60;

/** 2D cell -> 3D voxel scale for the weapon JSON (which is still in 2D units). */
export const LENGTH_NUM = 3;
export const LENGTH_DEN = 10;

/** Q16.16 constant from a ratio, rounded down. Integer-only so every engine agrees. */
const q = (num: number, den: number): number => Math.floor((num * FIXED_ONE) / den);

/** Voxels per tick^2, downwards. */
export const GRAVITY = q(6, 100);
export const TERMINAL_VELOCITY = q(36, 10);
/** Voxels per tick along the walk heading. */
export const WALK_SPEED = q(18, 100);
export const JUMP_VY = q(108, 100);
export const JUMP_VXZ = q(30, 100);
export const BACKFLIP_VY = q(150, 100);
export const BACKFLIP_VXZ = q(18, 100);

export const MAX_HEALTH = 100;
/** Falls up to this many voxels are free; beyond it each voxel costs FALL_DAMAGE_NUM/DEN HP. */
export const FALL_SAFE_DISTANCE = 15;
export const FALL_DAMAGE_NUM = 5;
export const FALL_DAMAGE_DEN = 3;

/** Wind component (-100..100) times this is the acceleration of wind-affected shots, Q16.16/tick^2. */
export const WIND_ACCEL_PER_UNIT = 10;

/** Muzzle: this far above the feet, and this far along the aim direction (clears the 1.5 radius). */
export const MUZZLE_HEIGHT = 4 * FIXED_ONE;
export const MUZZLE_REACH = q(5, 2);
/** The owner cannot be hit by its own projectile for this many ticks after firing. */
export const OWNER_GRACE_TICKS = 12;
/** A bouncing projectile slower than this (summed |components|) comes to rest. */
export const REST_SPEED = q(12, 100);
/** Projectiles flying this long (30 s) or this far outside the grid are discarded. */
export const MAX_PROJECTILE_AGE_TICKS = 30 * 60;
export const LOST_MARGIN = 100;
export const LOST_ALTITUDE = 1000;
