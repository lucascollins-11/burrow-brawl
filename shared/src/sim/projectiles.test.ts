import { describe, expect, it } from "vitest";
import { toFixed } from "../fixed";
import { createTerrain, DIRT, hashTerrain, isSolid } from "../terrain";
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
    expect(isSolid(r.state.terrain, boom.x, boom.y + 2)).toBe(false); // crater is empty near the blast centre
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

describe("purity across explosions", () => {
  it("never mutates the input terrain, so re-stepping the same state repeats exactly", () => {
    const t = flatWorld();
    let s = settle(createWorld(t, [createCritter(1, 0, 100, 299)], 490));
    s = stepWorld(s, fire("acorn-mortar", 45, 60)(0)).state;
    // Step until the very tick before the explosion.
    for (let i = 0; i < 600; i++) {
      const peek = stepWorld(s, []);
      if (peek.events.some((e) => e.type === "explosion")) break;
      s = peek.state;
    }
    const before = hashTerrain(s.terrain);
    const a = stepWorld(s, []);
    const b = stepWorld(s, []);
    expect(a.events.some((e) => e.type === "explosion")).toBe(true);
    expect(hashTerrain(s.terrain)).toBe(before); // input untouched
    expect(a.state.terrain).not.toBe(s.terrain); // copy on write
    expect(hashTerrain(a.state.terrain)).not.toBe(before); // the copy was carved
    expect(hashTerrain(a.state.terrain)).toBe(hashTerrain(b.state.terrain));
    expect(JSON.stringify(a.state.critters)).toBe(JSON.stringify(b.state.critters));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it("reuses the same terrain object while nothing explodes", () => {
    const s = settle(createWorld(flatWorld(), [createCritter(1, 0, 100, 299)], 490));
    expect(stepWorld(s, []).state.terrain).toBe(s.terrain);
  });
});

describe("limits and dead critters", () => {
  it("discards projectiles that fly too high or live too long", () => {
    const t = createTerrain(400, 300);
    const w = createWorld(t, [createCritter(1, 0, 200, 150)], 290);
    // Straight up at full power with no ground: it falls back, but a very old one is dropped.
    const old = {
      id: 1,
      ownerId: 1,
      weaponId: "fizz-grenade" as const,
      x: toFixed(200),
      y: toFixed(-5000),
      vx: 0,
      vy: 0,
      age: 5,
      fuseTicks: -1,
      bounces: 0,
      resting: false,
    };
    const high = stepWorld({ ...w, projectiles: [old] }, []);
    expect(high.events.some((e) => e.type === "projectileLost")).toBe(true);
    const aged = stepWorld({ ...w, projectiles: [{ ...old, y: toFixed(100), age: 100000 }] }, []);
    expect(aged.events.some((e) => e.type === "projectileLost")).toBe(true);
  });

  it("does not damage or push critters that are already dead", () => {
    const t = flatWorld();
    const base = settle(
      createWorld(t, [createCritter(1, 0, 100, 299), createCritter(2, 1, 120, 299)], 490),
    );
    const dead = { ...base.critters[1]!, status: "dead" as const, hp: 0, vx: 0, vy: 0 };
    const w = { ...base, critters: [base.critters[0]!, dead] };
    const r = run(w, 120, fire("acorn-mortar", 0, 20));
    expect(r.events.some((e) => e.type === "explosion")).toBe(true);
    expect(r.events.some((e) => e.type === "damage" && e.critterId === 2)).toBe(false);
    const after = r.state.critters[1]!;
    expect(after.x).toBe(dead.x);
    expect(after.vx).toBe(0);
  });
});
