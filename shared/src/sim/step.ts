import type { Fixed } from "../fixed";
import type { Terrain } from "../terrain";
import { isSolid } from "../terrain";
import {
  BACKFLIP_VX,
  BACKFLIP_VY,
  CRITTER_HALF_WIDTH,
  CRITTER_HEIGHT,
  FALL_DAMAGE_DIVISOR,
  FALL_SAFE_DISTANCE,
  GRAVITY,
  JUMP_VX,
  JUMP_VY,
  MAX_STEP_DOWN,
  MAX_STEP_UP,
  SIDE_CLEARANCE,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./constants";
import { spawnProjectile, stepProjectiles } from "./projectiles";
import type {
  Critter,
  CritterInput,
  Projectile,
  Rng,
  SimEvent,
  SimState,
  StepResult,
} from "./types";

const cell = (f: Fixed): number => f >> 16; // floor for negatives too

/**
 * True if the critter body, with feet at cell (x, y), overlaps terrain. The body is a capsule-ish
 * shape: the centre columns reach down to the feet, but the outer columns only start SIDE_CLEARANCE
 * cells above them, so slopes and small bumps are climbed by the feet instead of blocking the sides.
 */
export function bodyBlocked(t: Terrain, x: number, y: number): boolean {
  for (let dx = -CRITTER_HALF_WIDTH; dx <= CRITTER_HALF_WIDTH; dx++) {
    const from = Math.abs(dx) <= 1 ? 0 : SIDE_CLEARANCE;
    for (let dy = from; dy < CRITTER_HEIGHT; dy += 4) {
      if (isSolid(t, x + dx, y - dy)) return true;
    }
    if (isSolid(t, x + dx, y - (CRITTER_HEIGHT - 1))) return true;
  }
  return false;
}

/** True if solid ground lies directly under the feet (cell row y + 1), checked under the centre columns. */
export function hasGround(t: Terrain, x: number, y: number): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    if (isSolid(t, x + dx, y + 1)) return true;
  }
  return false;
}

function withInput(inputs: readonly CritterInput[], id: number): CritterInput | undefined {
  for (const i of inputs) if (i.critterId === id) return i;
  return undefined;
}

/** Advance one critter by one tick. Pure: returns a new critter and pushes events. */
function stepCritter(
  t: Terrain,
  c: Critter,
  input: CritterInput | undefined,
  events: SimEvent[],
): Critter {
  if (c.status !== "alive") return c;

  let x = c.x;
  let y = c.y;
  let vx = c.vx;
  let vy = c.vy;
  let facing = c.facing;
  let grounded = c.grounded;
  let peakY = c.peakY;

  const move = input?.move ?? 0;
  if (move !== 0) facing = move;

  if (grounded) {
    // Jumps launch from the ground.
    if (input?.jump || input?.backflip) {
      const back = !input.jump && !!input.backflip;
      vx = back ? -facing * BACKFLIP_VX : facing * JUMP_VX;
      vy = back ? BACKFLIP_VY : JUMP_VY;
      grounded = false;
      peakY = cell(y);
      events.push({ type: "jumped", critterId: c.id, backflip: back });
    } else {
      // Walk with a slope limit: step up to MAX_STEP_UP, snap down to MAX_STEP_DOWN.
      vx = 0;
      vy = 0;
      if (move !== 0) {
        const nx = x + move * WALK_SPEED;
        const cx = cell(nx);
        let cy = cell(y);
        let ok = false;
        for (let up = 0; up <= MAX_STEP_UP; up++) {
          if (!bodyBlocked(t, cx, cy - up)) {
            cy -= up;
            ok = true;
            break;
          }
        }
        if (ok) {
          // Walk down slopes while ground is within MAX_STEP_DOWN.
          let down = 0;
          while (down < MAX_STEP_DOWN && !hasGround(t, cx, cy)) {
            cy++;
            down++;
          }
          if (hasGround(t, cx, cy)) {
            x = nx;
            // Keep y on whole cells while walking so slopes do not accumulate drift.
            y = cy * 65536;
          } else {
            // Walked off a ledge: start falling at the new x.
            x = nx;
            grounded = false;
            peakY = cell(y);
          }
        }
      } else if (!hasGround(t, cell(x), cell(y))) {
        grounded = false; // ground vanished (carved away)
        peakY = cell(y);
      }
    }
  }

  if (!grounded) {
    vy = Math.min(vy + GRAVITY, TERMINAL_VELOCITY) | 0;
    // Substep so we never move more than one cell per axis per substep.
    const maxV = Math.max(Math.abs(vx), Math.abs(vy));
    const n = Math.max(1, Math.ceil(maxV / 65536));
    const sx = Math.trunc(vx / n) | 0;
    const sy = Math.trunc(vy / n) | 0;
    for (let i = 0; i < n; i++) {
      const nx = x + sx;
      if (sx !== 0 && bodyBlocked(t, cell(nx), cell(y))) {
        vx = 0; // hit a wall
      } else {
        x = nx;
      }
      const ny = y + sy;
      if (sy < 0 && bodyBlocked(t, cell(x), cell(ny))) {
        vy = 0; // bumped head
        break;
      }
      if (sy > 0 && cell(ny) !== cell(y) && bodyBlocked(t, cell(x), cell(ny))) {
        // Landed: stand on the cell above the obstruction.
        y = cell(y) * 65536;
        const fall = cell(y) - peakY;
        grounded = true;
        vx = 0;
        vy = 0;
        events.push({ type: "landed", critterId: c.id, fallDistance: fall });
        break;
      }
      y = ny;
      if (cell(y) < peakY) peakY = cell(y);
    }
  }

  return { ...c, x, y, vx, vy, facing, grounded, peakY };
}

/** Apply fall damage and resolve deaths from events produced this tick. Returns updated critters. */
function resolve(
  c: Critter,
  waterY: number,
  events: SimEvent[],
  tickEvents: readonly SimEvent[],
): Critter {
  let hp = c.hp;
  let status = c.status;
  if (status !== "alive") return c;
  for (const e of tickEvents) {
    if (e.type === "landed" && e.critterId === c.id && e.fallDistance > FALL_SAFE_DISTANCE) {
      const amount = Math.min(
        hp,
        Math.floor((e.fallDistance - FALL_SAFE_DISTANCE) / FALL_DAMAGE_DIVISOR),
      );
      if (amount > 0) {
        hp -= amount;
        events.push({ type: "damage", critterId: c.id, amount, cause: "fall" });
        if (hp <= 0) {
          status = "dead";
          events.push({ type: "died", critterId: c.id, cause: "fall" });
        }
      }
    }
  }
  if (status === "alive" && cell(c.y) > waterY) {
    hp = 0;
    status = "drowned";
    events.push({ type: "died", critterId: c.id, cause: "water" });
  }
  if (status === c.status && hp === c.hp) return c;
  return { ...c, hp, status, vx: 0, vy: 0 };
}

/**
 * Advance the world one 60 Hz tick. Pure with respect to its arguments (input state is never
 * modified); no Math.random, no Date. `rng` is injected for later systems (S4) and unused by movement.
 * Critters are stepped in array order, so results are order-stable.
 */
export function stepWorld(state: SimState, inputs: readonly CritterInput[], rng?: Rng): StepResult {
  void rng; // reserved for later systems (crate drops, scatter); S4 weapons are fully deterministic
  const moveEvents: SimEvent[] = [];
  let critters = state.critters.map((c) =>
    stepCritter(state.terrain, c, withInput(inputs, c.id), moveEvents),
  );

  // Fire commands spawn projectiles after movement, in critter order.
  const spawned: Projectile[] = [];
  let nextId = state.nextProjectileId;
  const fireEvents: SimEvent[] = [];
  critters = critters.map((c) => {
    const cmd = withInput(inputs, c.id)?.fire;
    if (!cmd || c.status !== "alive") return c;
    const made = spawnProjectile(c, cmd, nextId);
    if (!made) return c;
    nextId++;
    spawned.push(made.projectile);
    fireEvents.push({
      type: "fired",
      critterId: c.id,
      projectileId: made.projectile.id,
      weaponId: made.projectile.weaponId,
    });
    return { ...c, facing: made.facing };
  });

  // Projectiles fly after being spawned (so they move on the tick they are fired) and may explode.
  const blastEvents: SimEvent[] = [];
  const flown = stepProjectiles(
    state.terrain,
    [...state.projectiles, ...spawned],
    critters,
    state.wind,
    blastEvents,
  );
  critters = flown.critters;

  const events: SimEvent[] = [...moveEvents, ...fireEvents, ...blastEvents];
  critters = critters.map((c) => resolve(c, state.waterY, events, moveEvents));
  return {
    state: {
      ...state,
      tick: state.tick + 1,
      critters,
      projectiles: flown.projectiles,
      nextProjectileId: nextId,
    },
    events,
  };
}
