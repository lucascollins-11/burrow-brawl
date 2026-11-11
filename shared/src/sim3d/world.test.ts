import { describe, expect, it } from "vitest";
import { FIXED_ONE } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import type { CritterInput, FireCommand, SimEvent, SimState } from "./api";
import { CRITTER_HEIGHT } from "./api";
import { FALL_SAFE_DISTANCE, MAX_HEALTH, WALK_SPEED } from "./constants";
import { cell, FOOTPRINT } from "./critter";
import { applyEdit, flatSlab, isSolid } from "./terrainOps";
import { bodyBlocked, createCritter, createWorld, isSettled, sim3d, stepWorld } from "./world";

const rng = { nextInt: () => 0 };
const GROUND = 20;

function slab(): VoxelTerrain {
  return flatSlab(64, 96, 64, GROUND, 4);
}

function run(
  s: SimState,
  ticks: number,
  input: (tick: number) => readonly CritterInput[] = () => [],
): { state: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(s, input(i), rng);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const first = (s: SimState) => {
  const c = s.critters[0];
  if (!c) throw new Error("no critter");
  return c;
};

/** A critter standing on the slab at (x, z), already settled. */
function standing(t: VoxelTerrain, x = 32, z = 32): SimState {
  const s = run(createWorld(t, [createCritter(1, 0, x, GROUND, z)]), 2).state;
  expect(first(s).grounded).toBe(true);
  return s;
}

describe("sim3d contract", () => {
  it("implements Sim3dApi", () => {
    expect(Object.keys(sim3d).sort()).toEqual(
      ["bodyBlocked", "createCritter", "createWorld", "isSettled", "stepWorld"].sort(),
    );
  });

  it("uses a 3x3 footprint for the 1.5 voxel radius and a 6 voxel body", () => {
    expect(FOOTPRINT.length).toBe(9);
    const t = slab();
    expect(bodyBlocked(t, 32, GROUND, 32)).toBe(false);
    expect(bodyBlocked(t, 32, GROUND - 1, 32)).toBe(true);
    applyEdit(t, {
      op: "box",
      x0: 33,
      y0: GROUND + CRITTER_HEIGHT - 1,
      z0: 33,
      x1: 33,
      y1: GROUND + CRITTER_HEIGHT - 1,
      z1: 33,
    });
    expect(bodyBlocked(t, 32, GROUND, 32)).toBe(true); // corner column, head height
    expect(bodyBlocked(t, 31, GROUND, 31)).toBe(false);
  });
});

describe("critter movement", () => {
  it("falls onto the slab and lands without damage from a short drop", () => {
    const { state, events } = run(
      createWorld(slab(), [createCritter(1, 0, 32, GROUND + 5, 32)]),
      120,
    );
    const c = first(state);
    expect(c.grounded).toBe(true);
    expect(c.pos.y).toBe(GROUND * FIXED_ONE);
    expect(events.filter((e) => e.type === "landed")).toHaveLength(1);
    expect(events.some((e) => e.type === "damage")).toBe(false);
    expect(isSettled(state)).toBe(true);
  });

  it("takes fall damage from a long drop", () => {
    const h = FALL_SAFE_DISTANCE + 12;
    const { state, events } = run(
      createWorld(slab(), [createCritter(1, 0, 32, GROUND + h, 32)]),
      400,
    );
    expect(events).toContainEqual({ type: "landed", critterId: 1, fallDistance: h });
    expect(events).toContainEqual({ type: "damage", critterId: 1, amount: 20, cause: "fall" });
    expect(first(state).hp).toBe(MAX_HEALTH - 20);
  });

  it("walks along the yaw heading at walk speed: yaw 0 is +x, yaw 256 is +z", () => {
    const s0 = standing(slab());
    const x = run(s0, 30, () => [{ critterId: 1, moveYaw: 0 }]).state;
    expect(first(x).pos.x - first(s0).pos.x).toBe(30 * WALK_SPEED);
    expect(first(x).pos.z).toBe(first(s0).pos.z);
    expect(first(x).grounded).toBe(true);

    const z = run(s0, 30, () => [{ critterId: 1, moveYaw: 256 }]).state;
    expect(first(z).pos.z - first(s0).pos.z).toBe(30 * WALK_SPEED);
    expect(first(z).pos.x).toBe(first(s0).pos.x);
    expect(first(z).yaw).toBe(256);
  });

  it("climbs a 1 voxel step but not a 2 voxel wall", () => {
    const t = slab();
    applyEdit(t, { op: "box", x0: 36, y0: GROUND, z0: 0, x1: 63, y1: GROUND, z1: 63 });
    applyEdit(t, { op: "box", x0: 44, y0: GROUND + 1, z0: 0, x1: 63, y1: GROUND + 2, z1: 63 });
    const end = first(run(standing(t), 200, () => [{ critterId: 1, moveYaw: 0 }]).state);
    expect(end.grounded).toBe(true);
    expect(cell(end.pos.y)).toBe(GROUND + 1); // on the step
    expect(cell(end.pos.x)).toBe(42); // stopped by the wall: body edge at x = 43
  });

  it("slides along a wall instead of sticking to it", () => {
    const t = slab();
    applyEdit(t, { op: "box", x0: 36, y0: GROUND, z0: 0, x1: 63, y1: GROUND + 8, z1: 63 });
    const end = first(run(standing(t), 60, () => [{ critterId: 1, moveYaw: 128 }]).state); // 45 degrees
    expect(cell(end.pos.x)).toBe(34);
    expect(cell(end.pos.z)).toBeGreaterThan(36);
  });

  it("walks off a cliff and falls", () => {
    const t = slab();
    applyEdit(t, { op: "carve", x: 48, y: GROUND - 1, z: 32, r: 10 });
    const { state, events } = run(standing(t, 34), 200, (i) =>
      i < 60 ? [{ critterId: 1, moveYaw: 0 }] : [{ critterId: 1, moveYaw: -1 }],
    );
    expect(events.some((e) => e.type === "landed" && e.fallDistance > 2)).toBe(true);
    expect(cell(first(state).pos.y)).toBeLessThan(GROUND);
  });

  it("jumps forward and backflips backward, landing again", () => {
    const s0 = standing(slab());
    const jump = run(s0, 120, (i) => (i === 0 ? [{ critterId: 1, moveYaw: -1, jump: true }] : []));
    const flip = run(s0, 120, (i) =>
      i === 0 ? [{ critterId: 1, moveYaw: -1, backflip: true }] : [],
    );
    expect(jump.events[0]).toEqual({ type: "jumped", critterId: 1, backflip: false });
    expect(flip.events[0]).toEqual({ type: "jumped", critterId: 1, backflip: true });
    expect(first(jump.state).pos.x).toBeGreaterThan(first(s0).pos.x + 2 * FIXED_ONE);
    expect(first(flip.state).pos.x).toBeLessThan(first(s0).pos.x - FIXED_ONE);
    for (const r of [jump, flip]) {
      expect(first(r.state).grounded).toBe(true);
      expect(r.events.filter((e) => e.type === "landed")).toHaveLength(1);
    }
    // Peak height: the jump clears about 1.6 bodies.
    let peak = 0;
    let s = s0;
    for (let i = 0; i < 60; i++) {
      s = stepWorld(s, i === 0 ? [{ critterId: 1, moveYaw: -1, jump: true }] : [], rng).state;
      peak = Math.max(peak, first(s).pos.y - first(s0).pos.y);
    }
    expect(peak).toBeGreaterThan(8 * FIXED_ONE);
    expect(peak).toBeLessThan(11 * FIXED_ONE);
  });

  it("drowns when the feet go below the soda sea", () => {
    const t = flatSlab(64, 96, 64, 0, 10);
    const { state, events } = run(createWorld(t, [createCritter(1, 0, 32, 30, 32)]), 200);
    expect(first(state).status).toBe("drowned");
    expect(events).toContainEqual({ type: "died", critterId: 1, cause: "water" });
  });

  it("falls when the ground under a standing critter is carved away", () => {
    const t = slab();
    const s0 = standing(t);
    applyEdit(t, { op: "carve", x: 32, y: GROUND - 3, z: 32, r: 4 });
    const s = run(s0, 60).state;
    expect(cell(first(s).pos.y)).toBeLessThan(GROUND);
  });
});

const mortar = (yaw: number, pitch: number, power: number): FireCommand => ({
  weaponId: "acorn-mortar",
  yaw,
  pitch,
  power,
});

function fireOnce(s: SimState, cmd: FireCommand, ticks: number) {
  return run(s, ticks, (i) => (i === 0 ? [{ critterId: 1, moveYaw: -1, fire: cmd }] : []));
}

describe("projectiles", () => {
  it("an acorn mortar arcs, explodes on terrain, carves it and settles", () => {
    const t = slab();
    const s0 = standing(t, 8, 32);
    const { state, events } = fireOnce(s0, mortar(0, 45, 40), 600);
    const fired = events.find((e) => e.type === "fired");
    expect(fired).toMatchObject({ critterId: 1, projectileId: 1, weaponId: "acorn-mortar" });
    const blast = events.find((e) => e.type === "explosion");
    if (blast?.type !== "explosion") throw new Error("no explosion");
    expect(blast.edit).toMatchObject({ op: "carve", r: 12 });
    if (blast.edit.op !== "carve") throw new Error("not a carve");
    expect(blast.edit.x).toBeGreaterThan(20);
    expect(Math.abs(blast.edit.z - 32)).toBeLessThanOrEqual(1);
    expect(t.edits).toEqual([blast.edit]);
    expect(isSolid(t, blast.edit.x, GROUND - 1, blast.edit.z)).toBe(false);
    expect(state.projectiles).toHaveLength(0);
    expect(isSettled(state)).toBe(true);
  });

  it("the blast damages and knocks back a critter in range, scaled by distance", () => {
    const t = slab();
    const s0 = run(
      createWorld(t, [createCritter(1, 0, 32, GROUND, 32), createCritter(2, 1, 36, GROUND, 32)]),
      2,
    ).state;
    // Straight down at point blank: the acorn hits the slab between them.
    const { state, events } = fireOnce(s0, mortar(0, -89, 0), 300);
    const dmg = events.filter((e) => e.type === "damage" && e.cause === "explosion");
    expect(dmg.map((e) => e.type === "damage" && e.critterId)).toEqual([1, 2]);
    const [a, b] = dmg.map((e) => (e.type === "damage" ? e.amount : 0));
    expect(a).toBeGreaterThan(b ?? 0);
    const c2 = state.critters[1];
    expect(c2 && c2.pos.x).toBeGreaterThan(36 * FIXED_ONE + FIXED_ONE);
  });

  it("wind pushes the acorn mortar along both horizontal axes", () => {
    const blastAt = (windX: number, windZ: number) => {
      const t = slab();
      const s0 = { ...standing(t, 16, 32), windX, windZ };
      const e = fireOnce(s0, mortar(0, 60, 30), 600).events.find((x) => x.type === "explosion");
      if (e?.type !== "explosion" || e.edit.op !== "carve") throw new Error("no blast");
      return e.edit;
    };
    const calm = blastAt(0, 0);
    expect(blastAt(100, 0).x).toBeGreaterThan(calm.x);
    expect(blastAt(-100, 0).x).toBeLessThan(calm.x);
    expect(blastAt(0, 100).z).toBeGreaterThan(calm.z);
  });

  it("a fizz grenade bounces, comes to rest and goes off when its fuse runs out", () => {
    const t = slab();
    const s0 = standing(t, 16, 32);
    const cmd: FireCommand = {
      weaponId: "fizz-grenade",
      yaw: 0,
      pitch: 30,
      power: 50,
      fuseSeconds: 4,
    };
    let s = s0;
    const events: SimEvent[] = [];
    let blastTick = -1;
    for (let i = 0; i < 300 && blastTick < 0; i++) {
      const r = stepWorld(s, i === 0 ? [{ critterId: 1, moveYaw: -1, fire: cmd }] : [], rng);
      s = r.state;
      events.push(...r.events);
      if (r.events.some((e) => e.type === "explosion")) blastTick = i;
    }
    expect(blastTick).toBe(4 * 60 - 1);
    expect(events.filter((e) => e.type === "bounced").length).toBeGreaterThanOrEqual(2);
    expect(
      events.some((e) => e.type === "explosion" && e.edit.op === "carve" && e.edit.r === 10),
    ).toBe(true);
  });

  it("is deterministic: the same inputs give the same state and the same voxels", () => {
    const play = () => {
      const t = slab();
      const s0 = run(
        createWorld(t, [createCritter(1, 0, 10, GROUND, 10), createCritter(2, 1, 50, GROUND, 50)]),
        2,
      ).state;
      const script = (i: number): CritterInput[] => {
        if (i < 40) return [{ critterId: 1, moveYaw: 100 }];
        if (i === 40) return [{ critterId: 1, moveYaw: -1, fire: mortar(128, 50, 55) }];
        if (i === 200)
          return [
            {
              critterId: 2,
              moveYaw: -1,
              fire: { weaponId: "fizz-grenade", yaw: 640, pitch: 20, power: 70, fuseSeconds: 2 },
            },
          ];
        return [];
      };
      const r = run({ ...s0, windX: 37, windZ: -61 }, 500, script);
      return {
        state: { ...r.state, terrain: undefined },
        density: Array.from(t.density),
        events: r.events,
      };
    };
    const a = play();
    const b = play();
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(a.density).toEqual(b.density);
    expect(a.events.filter((e) => e.type === "explosion")).toHaveLength(2);
  });
});
