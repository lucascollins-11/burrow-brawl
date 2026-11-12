// sim3d's implementation of the contract's Sim3dApi. Same tick order as the 2D sim: critters
// move, fire commands spawn projectiles, projectiles fly (and may carve terrain), then fall
// damage and the soda sea are resolved.

import type { VoxelTerrain } from "../terrain3d/api";
import type {
  Critter,
  CritterInput,
  FireCommand,
  Projectile,
  Rng,
  Sim3dApi,
  SimEvent,
  SimState,
  StepResult,
} from "./api";
import { YAW_STEPS } from "./api";
import { FALL_DAMAGE_DEN, FALL_DAMAGE_NUM, FALL_SAFE_DISTANCE } from "./constants";
import { bodyBlocked, cell, createCritter, stepCritter } from "./critter";
import { fireHitscan, isHitscanWeapon, spawnShots, stepProjectiles } from "./projectile";

export function createWorld(terrain: VoxelTerrain, critters: readonly Critter[]): SimState {
  return {
    tick: 0,
    critters,
    projectiles: [],
    nextProjectileId: 1,
    terrain,
    windX: 0,
    windZ: 0,
    seaY: terrain.seaY,
  };
}

function inputFor(inputs: readonly CritterInput[], id: number): CritterInput | undefined {
  for (const i of inputs) if (i.critterId === id) return i;
  return undefined;
}

/** Fall damage from this tick's landings, then the soda sea. */
function resolve(
  c: Critter,
  seaY: number,
  out: SimEvent[],
  moveEvents: readonly SimEvent[],
): Critter {
  if (c.status !== "alive") return c;
  let hp = c.hp;
  let status: Critter["status"] = c.status;
  for (const e of moveEvents) {
    if (e.type !== "landed" || e.critterId !== c.id || e.fallDistance <= FALL_SAFE_DISTANCE)
      continue;
    const amount = Math.min(
      hp,
      Math.floor(((e.fallDistance - FALL_SAFE_DISTANCE) * FALL_DAMAGE_NUM) / FALL_DAMAGE_DEN),
    );
    if (amount <= 0) continue;
    hp -= amount;
    out.push({ type: "damage", critterId: c.id, amount, cause: "fall" });
    if (hp <= 0) {
      status = "dead";
      out.push({ type: "died", critterId: c.id, cause: "fall" });
    }
  }
  if (status === "alive" && cell(c.pos.y) < seaY) {
    hp = 0;
    status = "drowned";
    out.push({ type: "died", critterId: c.id, cause: "water" });
  }
  if (status === c.status && hp === c.hp) return c;
  return { ...c, hp, status, vel: { x: 0, y: 0, z: 0 } };
}

/**
 * Advance one 60 Hz tick. Critters and projectiles are new records; the terrain is edited in
 * place. No Math.random or clocks: `rng` is reserved for later systems (crates, scatter).
 */
export function stepWorld(state: SimState, inputs: readonly CritterInput[], rng: Rng): StepResult {
  void rng;
  const t = state.terrain;
  const moveEvents: SimEvent[] = [];
  let critters = state.critters.map((c) => stepCritter(t, c, inputFor(inputs, c.id), moveEvents));

  const fireEvents: SimEvent[] = [];
  const spawned: Projectile[] = [];
  const scans: { critterId: number; cmd: FireCommand }[] = [];
  let nextId = state.nextProjectileId;
  critters = critters.map((c) => {
    const cmd = inputFor(inputs, c.id)?.fire;
    if (!cmd || c.status !== "alive") return c;
    const facing = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
    if (isHitscanWeapon(cmd.weaponId)) {
      scans.push({ critterId: c.id, cmd });
      fireEvents.push({ type: "fired", critterId: c.id, projectileId: -1, weaponId: cmd.weaponId });
      return { ...c, yaw: facing };
    }
    const shots = spawnShots(t, c, cmd, nextId);
    const p = shots[0];
    if (!p) return c;
    nextId += shots.length;
    spawned.push(...shots);
    // One "fired" per command, naming the fired weapon and its first projectile.
    fireEvents.push({ type: "fired", critterId: c.id, projectileId: p.id, weaponId: cmd.weaponId });
    return { ...c, yaw: facing };
  });
  // Hitscan shots land at once, after everyone has moved and turned this tick.
  for (const scan of scans) {
    const shooter = critters.find((c) => c.id === scan.critterId);
    if (shooter) critters = fireHitscan(t, critters, shooter, scan.cmd, fireEvents);
  }

  const triggers = new Set<number>();
  for (const i of inputs) {
    if (!i.trigger) continue;
    const c = critters.find((k) => k.id === i.critterId);
    if (c && c.status === "alive") triggers.add(c.id);
  }

  const blastEvents: SimEvent[] = [];
  const flown = stepProjectiles(
    t,
    [...state.projectiles, ...spawned],
    critters,
    state.windX,
    state.windZ,
    blastEvents,
    triggers,
    nextId,
  );

  const events: SimEvent[] = [...moveEvents, ...fireEvents, ...blastEvents];
  critters = flown.critters.map((c) => resolve(c, state.seaY, events, moveEvents));
  return {
    state: {
      ...state,
      tick: state.tick + 1,
      critters,
      projectiles: flown.projectiles,
      nextProjectileId: flown.nextId,
    },
    events,
  };
}

/** True when no projectile is live and every living critter is grounded and still. */
export function isSettled(state: SimState): boolean {
  if (state.projectiles.length > 0) return false;
  return state.critters.every(
    (c) => c.status !== "alive" || (c.grounded && c.vel.x === 0 && c.vel.y === 0 && c.vel.z === 0),
  );
}

export { bodyBlocked, createCritter };

/** The contract object, so a type error shows here if an implementation drifts from it. */
export const sim3d: Sim3dApi = { createWorld, createCritter, stepWorld, isSettled, bodyBlocked };
