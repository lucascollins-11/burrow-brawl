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
import { inGlue } from "./zones";
import { fireInstant, isDormant, isInstantWeapon, spawnShots, stepProjectiles } from "./projectile";

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
export function stepWorld(state: SimState, given: readonly CritterInput[], rng: Rng): StepResult {
  void rng;
  const inputs = restrain(state, given);
  const t = state.terrain;
  const moveEvents: SimEvent[] = [];
  let critters = state.critters.map((c) => stepCritter(t, c, inputFor(inputs, c.id), moveEvents));

  const fireEvents: SimEvent[] = [];
  const spawned: Projectile[] = [];
  const scans: { critterId: number; cmd: FireCommand }[] = [];
  let nextId = state.nextProjectileId;
  critters = critters.map((c) => {
    const cmd = inputFor(inputs, c.id)?.fire;
    // A drilling critter can't fire until the drill stops.
    if (!cmd || c.status !== "alive" || c.drillTicks !== undefined) return c;
    const facing = ((Math.trunc(cmd.yaw) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
    if (isInstantWeapon(cmd.weaponId)) {
      scans.push({ critterId: c.id, cmd });
      return { ...c, yaw: facing };
    }
    const fresh = spawnShots(t, c, cmd, nextId);
    const shots = c.feather ? fresh.map((s) => ({ ...s, light: true as const })) : fresh;
    const p = shots[0];
    if (!p) return c;
    nextId += shots.length;
    spawned.push(...shots);
    // One "fired" per command, naming the fired weapon and its first projectile.
    fireEvents.push({ type: "fired", critterId: c.id, projectileId: p.id, weaponId: cmd.weaponId });
    return { ...c, yaw: facing };
  });
  // Instant weapons act at once, after everyone has moved and turned this tick. A refused one
  // (a burrow with nowhere to come up) reports no `fired`, so it costs neither ammo nor the turn.
  for (const scan of scans) {
    const shooter = critters.find((c) => c.id === scan.critterId);
    if (!shooter) continue;
    const acted: SimEvent[] = [];
    const after = fireInstant(t, critters, shooter, scan.cmd, acted);
    if (after === null) continue;
    critters = after;
    fireEvents.push(
      { type: "fired", critterId: shooter.id, projectileId: -1, weaponId: scan.cmd.weaponId },
      ...acted,
    );
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
    fireEvents,
    state.seaY,
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
      ...(flown.zones.length ? { zones: [...(state.zones ?? []), ...flown.zones] } : {}),
    },
    events,
  };
}

/**
 * Inputs after statuses: a frozen critter does nothing at all; one standing in glue can still
 * aim and fire but not walk or jump.
 */
function restrain(state: SimState, inputs: readonly CritterInput[]): readonly CritterInput[] {
  if (!state.zones && !state.critters.some((c) => c.frozen)) return inputs;
  const out: CritterInput[] = [];
  for (const i of inputs) {
    const c = state.critters.find((k) => k.id === i.critterId);
    if (!c) continue;
    if (c.frozen) continue;
    if (c.grounded && inGlue(state.zones, c)) {
      const { jump: _j, backflip: _b, ...rest } = i;
      void [_j, _b];
      out.push({ ...rest, moveYaw: -1 });
    } else out.push(i);
  }
  return out;
}

/**
 * True when no projectile is live and every living critter is grounded and still. A mine lying
 * in wait is not live.
 */
export function isSettled(state: SimState): boolean {
  if (state.projectiles.some((p) => !isDormant(p))) return false;
  if (state.critters.some((c) => c.drillTicks !== undefined)) return false;
  return state.critters.every(
    (c) => c.status !== "alive" || (c.grounded && c.vel.x === 0 && c.vel.y === 0 && c.vel.z === 0),
  );
}

export { bodyBlocked, createCritter };

/** The contract object, so a type error shows here if an implementation drifts from it. */
export const sim3d: Sim3dApi = { createWorld, createCritter, stepWorld, isSettled, bodyBlocked };
