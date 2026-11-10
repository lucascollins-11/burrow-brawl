import { toFixed } from "../fixed";

/** Fixed step: the whole sim advances in 1/60 s ticks. */
export const TICK_RATE = 60;

// Units: terrain cells per tick (velocity) and cells per tick^2 (gravity), Q16.16.
export const GRAVITY = toFixed(0.2);
export const TERMINAL_VELOCITY = toFixed(12);
export const WALK_SPEED = toFixed(0.6);

export const JUMP_VY = toFixed(-3.6);
export const JUMP_VX = toFixed(1.0);
export const BACKFLIP_VY = toFixed(-5);
export const BACKFLIP_VX = toFixed(0.6);

/** Critter body: feet at (x, y); occupies HALF_WIDTH cells left/right and HEIGHT cells up. */
export const CRITTER_HALF_WIDTH = 5;
export const CRITTER_HEIGHT = 20;

/** Outer body columns ignore terrain within this many cells of the feet (see bodyBlocked). */
export const SIDE_CLEARANCE = 8;

/** Walking can climb this many cells per cell moved (slope limit), and snaps down this many. */
export const MAX_STEP_UP = 2;
export const MAX_STEP_DOWN = 4;

export const MAX_HEALTH = 100;
/** Falls up to this many cells are free; beyond it, damage = (distance - SAFE) / FALL_DAMAGE_DIVISOR. */
export const FALL_SAFE_DISTANCE = 50;
export const FALL_DAMAGE_DIVISOR = 2;

/** Wind strength (-100..100) times this is the sideways acceleration of wind-affected projectiles, per tick^2. */
export const WIND_ACCEL_PER_UNIT = toFixed(0.0005);

/** A projectile that is still flying after this many ticks (30 s) is discarded. */
export const MAX_PROJECTILE_AGE_TICKS = 30 * TICK_RATE;
/** A projectile this many cells above the top of the map is discarded. */
export const MAX_PROJECTILE_ALTITUDE = 4000;
