import { describe, expect, it } from "vitest";
import { fromFixed, toFixed } from "../fixed";
import { carveCircle, createTerrain, DIRT, isSolid } from "../terrain";
import { createCritter, createWorld, maybeDropCrate, stepWorld } from "./index";
import type { CritterInput, SimEvent, SimState } from "./index";

/** Flat ground at `floorY`, with an optional solid slab (ceiling) from y=0 to `ceilingY`. */
function world(floorY = 300, ceilingY = 0) {
  const t = createTerrain(800, 500);
  for (let y = floorY; y < 500; y++) for (let x = 0; x < 800; x++) t.cells[y * 800 + x] = DIRT;
  for (let y = 0; y < ceilingY; y++) for (let x = 0; x < 800; x++) t.cells[y * 800 + x] = DIRT;
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

function withInv(s: SimState, inv: Record<string, number>): SimState {
  return { ...s, inventory: s.inventory.map(() => ({ ...inv })) };
}

const fireAt =
  (weaponId: "rope-claw" | "drill-hat" | "boulder-of-doom", angleDeg: number) =>
  (tick: number): CritterInput[] =>
    tick === 0 ? [{ critterId: 1, move: 0, fire: { weaponId, angleDeg, power: 50 } }] : [];

describe("rope claw", () => {
  it("attaches to a ceiling, pulls the critter up and swings without fall damage", () => {
    const t = world(400, 150);
    const w = run(createWorld(t, [createCritter(1, 0, 300, 399)], 490), 10).state;
    const r = run(w, 120, fireAt("rope-claw", 90));
    expect(r.events.some((e) => e.type === "gadget" && e.phase === "attached")).toBe(true);
    // The rope doesn't use the turn.
    expect(r.events.some((e) => e.type === "fired")).toBe(false);
    const c = r.state.critters[0]!;
    expect(r.state.ropes).toHaveLength(1);
    expect(fromFixed(c.y)).toBeLessThan(399 - 60); // hauled well off the ground
    expect(c.hp).toBe(100);
    // Pushing sideways builds a swing.
    const swung = run(r.state, 120, () => [{ critterId: 1, move: 1 }]).state.critters[0]!;
    expect(Math.abs(fromFixed(swung.x) - 300)).toBeGreaterThan(5);
  });

  it("lets go on jump and then falls normally", () => {
    const t = world(400, 150);
    let s = run(createWorld(t, [createCritter(1, 0, 300, 399)], 490), 10).state;
    s = run(s, 80, fireAt("rope-claw", 90)).state;
    const r = run(s, 1, () => [{ critterId: 1, move: 0, jump: true }]);
    expect(r.state.ropes).toHaveLength(0);
    expect(r.events.some((e) => e.type === "gadget" && e.phase === "released")).toBe(true);
    const after = run(r.state, 200).state.critters[0]!;
    expect(after.grounded).toBe(true);
  });

  it("falls short when nothing is in range", () => {
    const t = world(400);
    const s = run(createWorld(t, [createCritter(1, 0, 300, 399)], 490), 10).state;
    const r = run(s, 40, fireAt("rope-claw", 90));
    expect(r.state.ropes).toHaveLength(0);
    expect(r.events.some((e) => e.type === "gadget" && e.phase === "released")).toBe(true);
  });
});

describe("drill hat", () => {
  it("digs down for three seconds, spends ammo and takes no fall damage", () => {
    const t = world(300);
    let s = run(createWorld(t, [createCritter(1, 0, 300, 299)], 490), 10).state;
    expect(s.inventory[0]!["drill-hat"]).toBe(2);
    const r = run(s, 200, fireAt("drill-hat", 270));
    s = r.state;
    expect(s.inventory[0]!["drill-hat"]).toBe(1);
    expect(s.drills).toHaveLength(0);
    expect(r.events.some((e) => e.type === "gadget" && e.phase === "ended")).toBe(true);
    const c = s.critters[0]!;
    expect(fromFixed(c.y)).toBeGreaterThan(299 + 100);
    expect(c.hp).toBe(100);
    expect(isSolid(s.terrain, 300, 299 + 50)).toBe(false); // a shaft was cut
  });

  it("digs sideways into a hill", () => {
    const t = world(300);
    for (let y = 200; y < 300; y++) for (let x = 330; x < 700; x++) t.cells[y * 800 + x] = DIRT;
    const s = run(createWorld(t, [createCritter(1, 0, 300, 299)], 490), 10).state;
    const r = run(s, 200, fireAt("drill-hat", 0));
    expect(fromFixed(r.state.critters[0]!.x)).toBeGreaterThan(450);
    expect(isSolid(r.state.terrain, 400, 280)).toBe(false);
  });

  it("does nothing without ammo", () => {
    const t = world(300);
    let s = run(createWorld(t, [createCritter(1, 0, 300, 299)], 490), 10).state;
    s = withInv(s, { "drill-hat": 0 });
    const r = run(s, 30, fireAt("drill-hat", 270));
    expect(r.state.drills).toHaveLength(0);
    expect(fromFixed(r.state.critters[0]!.y)).toBe(299);
  });

  it("stops at bedrock", () => {
    const t = world(300);
    for (let y = 360; y < 500; y++) for (let x = 0; x < 800; x++) t.cells[y * 800 + x] = 255;
    const s = run(createWorld(t, [createCritter(1, 0, 300, 299)], 490), 10).state;
    const r = run(s, 200, fireAt("drill-hat", 270));
    expect(fromFixed(r.state.critters[0]!.y)).toBeLessThan(362);
    expect(r.state.terrain.cells[400 * 800 + 300]).toBe(255);
  });
});

describe("boulder of doom", () => {
  it("is crate-only: no uses until a crate gives one", () => {
    const s = run(createWorld(world(), [createCritter(1, 0, 100, 299)], 490), 10).state;
    expect(s.inventory[0]!["boulder-of-doom"] ?? 0).toBe(0);
    const r = run(s, 20, fireAt("boulder-of-doom", 0));
    expect(r.state.boulders).toHaveLength(0);
  });

  it("rolls across the ground, crushes a critter once and ends the turn's shot event", () => {
    const t = world(300);
    let s = run(
      createWorld(t, [createCritter(1, 0, 100, 299), createCritter(2, 1, 220, 299)], 490),
      10,
    ).state;
    s = withInv(s, { "boulder-of-doom": 1 });
    const r = run(s, 200, fireAt("boulder-of-doom", 0));
    expect(r.events.filter((e) => e.type === "fired")).toHaveLength(1); // endsTurn weapon
    const hits = r.events.filter((e) => e.type === "damage" && e.critterId === 2);
    expect(hits).toHaveLength(1);
    expect(r.state.critters[1]!.hp).toBeLessThan(100);
    expect(r.state.inventory[0]!["boulder-of-doom"]).toBe(0);
    // It keeps rolling to the far edge, then disappears.
    const done = run(r.state, 700);
    expect(done.state.boulders).toHaveLength(0);
  });

  it("flattens a hill in its way without digging into the floor", () => {
    const t = world(300);
    for (let y = 280; y < 300; y++) for (let x = 300; x < 340; x++) t.cells[y * 800 + x] = DIRT;
    let s = run(createWorld(t, [createCritter(1, 0, 100, 299)], 490), 10).state;
    s = withInv(s, { "boulder-of-doom": 1 });
    const r = run(s, 400, fireAt("boulder-of-doom", 0));
    expect(isSolid(r.state.terrain, 320, 285)).toBe(false); // bump flattened
    expect(isSolid(r.state.terrain, 320, 305)).toBe(true); // floor intact
  });
});

describe("supply crates", () => {
  const always = (v: number[]) => {
    let i = 0;
    return { nextInt: () => v[i++ % v.length]! };
  };

  it("drops from the rng, falls, rests on the ground and is collected for health", () => {
    const base = run(
      createWorld(world(300), [createCritter(1, 0, 100, 299), createCritter(2, 1, 400, 299)], 490),
      10,
    ).state;
    // roll 0 -> drops; x = 40 + 60 = 100... use x = 400 - 40 = 360 + 40: nextInt values: roll, x, kind
    const dropped = maybeDropCrate(base, always([0, 360, 0]));
    expect(dropped.events[0]).toMatchObject({ type: "crateDropped", kind: "health", x: 400 });
    let s: SimState = {
      ...dropped.sim,
      critters: dropped.sim.critters.map((c) => (c.id === 2 ? { ...c, hp: 50 } : c)),
    };
    const r = run(s, 400);
    s = r.state;
    expect(s.crates).toHaveLength(0);
    const got = r.events.find((e) => e.type === "crateCollected");
    expect(got).toMatchObject({ kind: "health", critterId: 2, amount: 25 });
    expect(s.critters[1]!.hp).toBe(75);
  });

  it("a weapon crate adds a use to the collector's team", () => {
    const base = run(createWorld(world(300), [createCritter(1, 0, 400, 299)], 490), 10).state;
    const dropped = maybeDropCrate(base, always([0, 360, 1, 0]));
    expect(dropped.events[0]).toMatchObject({ kind: "weapon" });
    const r = run(dropped.sim, 400);
    expect(r.state.inventory[0]!["boulder-of-doom"]).toBe(1);
  });

  it("does not drop on a failed roll or when too many are on the map", () => {
    const base = createWorld(world(300), [createCritter(1, 0, 100, 299)], 490);
    expect(maybeDropCrate(base, always([99])).sim).toBe(base);
    const crowded: SimState = {
      ...base,
      crates: [1, 2, 3].map((id) => ({
        id,
        x: 50 * id,
        y: toFixed(10),
        vy: 0,
        kind: "health" as const,
        weaponId: null,
        grounded: false,
      })),
    };
    expect(maybeDropCrate(crowded, always([0, 0, 0])).sim).toBe(crowded);
  });

  it("a crate falls again when the ground under it is carved away", () => {
    const base = run(createWorld(world(300), [createCritter(1, 0, 100, 299)], 490), 10).state;
    let s = maybeDropCrate(base, always([0, 560, 0])).sim; // x = 600
    s = run(s, 300).state;
    const before = s.crates[0]!;
    expect(before.grounded).toBe(true);
    carveCircle(s.terrain, 600, 305, 20);
    s = run(s, 60).state;
    expect(fromFixed(s.crates[0]!.y)).toBeGreaterThan(fromFixed(before.y) + 5);
  });
});
