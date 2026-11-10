import { describe, expect, it } from "vitest";
import { toFixed } from "../fixed";
import { createTerrain, DIRT, isSolid } from "../terrain";
import type { CritterInput, SimEvent, SimState } from "./index";
import { createCritter, createWorld, stepWorld } from "./index";

function flatWorld(floorY = 300) {
  const t = createTerrain(800, 500);
  for (let y = floorY; y < 500; y++) for (let x = 0; x < 800; x++) t.cells[y * 800 + x] = DIRT;
  return t;
}

function run(state: SimState, ticks: number, input: (tick: number) => CritterInput[] = () => []) {
  const events: SimEvent[] = [];
  let s = state;
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(s, input(i));
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const settle = (w: SimState) => run(w, 10).state;
const fire =
  (
    weaponId: "acorn-mortar" | "fizz-grenade",
    angleDeg: number,
    power: number,
    fuseSeconds?: number,
  ) =>
  (tick: number): CritterInput[] =>
    tick === 0
      ? [
          {
            critterId: 1,
            move: 0,
            fire: { weaponId, angleDeg, power, ...(fuseSeconds ? { fuseSeconds } : {}) },
          },
        ]
      : [];

describe("firing", () => {
  it("spawns a projectile ahead of the critter and emits fired", () => {
    const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 200, 299)], 490));
    const r = stepWorld(w, fire("acorn-mortar", 45, 50)(0));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "fired", critterId: 1 }));
    expect(r.state.projectiles).toHaveLength(1);
    const p = r.state.projectiles[0]!;
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vy).toBeLessThan(0);
    expect(p.x).toBeGreaterThan(w.critters[0]!.x);
    expect(r.state.nextProjectileId).toBe(2);
  });

  it("ignores unsupported weapons, dead critters and unknown ids", () => {
    const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 200, 299)], 490));
    const bad = stepWorld(w, [
      { critterId: 1, move: 0, fire: { weaponId: "skip-turn", angleDeg: 0, power: 50 } },
    ]);
    expect(bad.state.projectiles).toHaveLength(0);
    const dead = { ...w, critters: [{ ...w.critters[0]!, status: "dead" as const }] };
    expect(stepWorld(dead, fire("acorn-mortar", 45, 50)(0)).state.projectiles).toHaveLength(0);
  });

  it("scales speed with power and clamps it to 0..100", () => {
    const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 200, 299)], 490));
    const speed = (power: number) => {
      const p = stepWorld(w, fire("acorn-mortar", 0, power)(0)).state.projectiles[0]!;
      return p.vx;
    };
    expect(speed(100)).toBeGreaterThan(speed(50));
    expect(speed(500)).toBe(speed(100));
    expect(speed(-5)).toBe(0);
  });
});

describe("Acorn Mortar", () => {
  it("flies in an arc, explodes on terrain, carves a crater and emits an explosion event", () => {
    const t = flatWorld();
    const w = settle(createWorld(t, [createCritter(1, 0, 100, 299)], 490));
    const r = run(w, 400, fire("acorn-mortar", 45, 60));
    const boom = r.events.find((e) => e.type === "explosion") as Extract<
      SimEvent,
      { type: "explosion" }
    >;
    expect(boom).toBeDefined();
    expect(boom.weaponId).toBe("acorn-mortar");
    expect(boom.cellsRemoved).toBeGreaterThan(0);
    expect(boom.x).toBeGreaterThan(150);
    expect(isSolid(t, boom.x, boom.y + 2)).toBe(false); // crater is empty near the blast centre
    expect(r.state.projectiles).toHaveLength(0);
  });

  it("is pushed by wind but not unaffected weapons", () => {
    const land = (wind: number) => {
      const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 100, 299)], 490, wind));
      const r = run(w, 400, fire("acorn-mortar", 60, 60));
      return (
        r.events.find((e) => e.type === "explosion") as Extract<SimEvent, { type: "explosion" }>
      ).x;
    };
    expect(land(80)).toBeGreaterThan(land(0));
    expect(land(-80)).toBeLessThan(land(0));
  });

  it("damages critters in the blast with linear falloff (closer takes more) and knocks them back", () => {
    // First pass: find where the shell lands with nobody around.
    const probe = run(
      settle(createWorld(flatWorld(), [createCritter(1, 0, 100, 299)], 490)),
      300,
      fire("acorn-mortar", 35, 62),
    );
    const boom = probe.events.find((e) => e.type === "explosion") as Extract<
      SimEvent,
      { type: "explosion" }
    >;
    // Second pass: critter 2 stands 8 cells past the impact point, critter 3 stands 26 cells past it.
    const critters = [
      createCritter(1, 0, 100, 299),
      createCritter(2, 1, boom.x + 8, 299),
      createCritter(3, 1, boom.x + 26, 299),
    ];
    const w = settle(createWorld(flatWorld(), critters, 490));
    const r = run(w, 300, fire("acorn-mortar", 35, 62));
    const dealt = (id: number) =>
      r.events.reduce(
        (n, e) =>
          e.type === "damage" && e.critterId === id && e.cause === "explosion" ? n + e.amount : n,
        0,
      );
    expect(dealt(2)).toBeGreaterThan(0);
    expect(dealt(3)).toBeGreaterThan(0);
    expect(dealt(2)).toBeGreaterThan(dealt(3));
    const c2 = r.state.critters.find((c) => c.id === 2)!;
    expect(c2.hp).toBe(100 - dealt(2));
  });

  it("explodes on a critter it touches, never on its owner right after firing", () => {
    const t = flatWorld();
    const w = settle(
      createWorld(t, [createCritter(1, 0, 100, 299), createCritter(2, 1, 150, 299)], 490),
    );
    const r = run(w, 120, fire("acorn-mortar", 5, 40));
    const boom = r.events.find((e) => e.type === "explosion") as Extract<
      SimEvent,
      { type: "explosion" }
    >;
    expect(boom).toBeDefined();
    expect(boom.x).toBeGreaterThan(110); // not on the owner
    expect(r.events.some((e) => e.type === "damage" && e.critterId === 2)).toBe(true);
  });
});

describe("explosion knockback", () => {
  it("launches a critter away from the blast centre", () => {
    const t = flatWorld();
    const w = settle(
      createWorld(t, [createCritter(1, 0, 100, 299), createCritter(2, 1, 120, 299)], 490),
    );
    // Point-blank shell: detonates on critter 2, which stands right of the blast centre.
    const first = stepWorld(w, fire("acorn-mortar", 0, 20)(0));
    const next = run(first.state, 3);
    const c2 = next.state.critters.find((c) => c.id === 2)!;
    const exploded = [...first.events, ...next.events].some((e) => e.type === "explosion");
    expect(exploded).toBe(true);
    expect(c2.x).toBeGreaterThan(toFixed(120));
    expect(c2.hp).toBeLessThan(100);
  });
});

describe("Fizz Grenade", () => {
  it("bounces, rests, and explodes when its fuse runs out", () => {
    const t = flatWorld();
    const w = settle(createWorld(t, [createCritter(1, 0, 100, 299)], 490));
    const r = run(w, 400, fire("fizz-grenade", 40, 50, 2));
    expect(r.events.filter((e) => e.type === "bounced").length).toBeGreaterThan(0);
    const boomTick = r.events.findIndex((e) => e.type === "explosion");
    expect(boomTick).toBeGreaterThan(-1);
    expect(r.state.projectiles).toHaveLength(0);
  });

  it("honours the fuse length (clamped to the weapon's range)", () => {
    const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 100, 299)], 490));
    const fuse = (secs: number) =>
      stepWorld(w, fire("fizz-grenade", 40, 0, secs)(0)).state.projectiles[0]!.fuseTicks;
    expect(fuse(2)).toBe(119); // 2 s = 120 ticks, minus this tick
    expect(fuse(99)).toBe(299); // clamped to 5 s
    expect(fuse(0.1)).toBe(59); // clamped to 1 s
  });

  it("is not affected by wind", () => {
    const x = (wind: number) => {
      const w = settle(createWorld(flatWorld(), [createCritter(1, 0, 100, 299)], 490, wind));
      return run(w, 30, fire("fizz-grenade", 40, 50, 5)).state.projectiles[0]!.x;
    };
    expect(x(100)).toBe(x(-100));
  });
});

describe("projectiles leaving the map", () => {
  it("are removed with projectileLost", () => {
    const t = createTerrain(400, 300); // all air
    const w = createWorld(t, [createCritter(1, 0, 200, 150)], 290);
    const r = run(w, 200, fire("acorn-mortar", 0, 100));
    expect(r.events.some((e) => e.type === "projectileLost")).toBe(true);
    expect(r.state.projectiles).toHaveLength(0);
  });
});
