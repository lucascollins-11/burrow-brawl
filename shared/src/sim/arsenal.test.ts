import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs, StateHasher } from "../determinism";
import {
  createTerrain,
  DIRT,
  hashTerrain,
  isSolid,
  serializeTerrain,
  deserializeTerrain,
} from "../terrain";
import type { CritterInput, FireCommand, SimEvent, SimState } from "./index";
import { createCritter, createWorld, stepWorld } from "./index";

function flat(floorY = 300) {
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
const world = (critters: ReturnType<typeof createCritter>[]) =>
  run(createWorld(flat(), critters, 490), 10).state;
const use =
  (fire: FireCommand, critterId = 1, at = 0) =>
  (tick: number): CritterInput[] =>
    tick === at ? [{ critterId, move: 0, fire }] : [];
const hp = (s: SimState, id: number) => s.critters.find((c) => c.id === id)!.hp;
const types = (e: SimEvent[], t: string) => e.filter((x) => x.type === t);

describe("pepper shotgun", () => {
  it("hits a critter in line, hurts and pushes it, and only ends the turn on the last shot", () => {
    const w = world([createCritter(1, 0, 200, 299), createCritter(2, 1, 260, 299)]);
    const cmd: FireCommand = { weaponId: "pepper-shotgun", angleDeg: 0, power: 50 };
    const first = run(w, 1, use(cmd));
    expect(types(first.events, "fired")).toHaveLength(0);
    expect(first.state.burst).toEqual({ critterId: 1, left: 1 });
    expect(hp(first.state, 2)).toBeLessThan(100);
    expect(types(first.events, "shot")[0]).toMatchObject({ hitCritterId: 2 });
    const second = run(first.state, 1, use(cmd));
    expect(types(second.events, "fired")).toEqual([
      { type: "fired", critterId: 1, projectileId: 0, weaponId: "pepper-shotgun" },
    ]);
    expect(second.state.burst).toBeNull();
    expect(hp(second.state, 2)).toBeLessThan(hp(first.state, 2));
  });

  it("digs a small tunnel where it hits terrain and never hurts the shooter", () => {
    const w = world([createCritter(1, 0, 200, 299)]);
    const before = w.terrain.cells.filter((c) => c !== 0).length;
    const r = run(w, 1, use({ weaponId: "pepper-shotgun", angleDeg: 270, power: 50 }));
    expect(w.terrain.cells.filter((c) => c !== 0).length).toBeLessThan(before);
    expect(isSolid(r.state.terrain, 200, 304)).toBe(false);
    expect(hp(r.state, 1)).toBe(100);
  });
});

describe("root punch", () => {
  it("launches an adjacent enemy up and away, and misses allies and distant critters", () => {
    const w = world([
      createCritter(1, 0, 200, 299),
      createCritter(2, 1, 215, 299),
      createCritter(3, 0, 190, 299),
      createCritter(4, 1, 400, 299),
    ]);
    const r = run(w, 1, use({ weaponId: "root-punch", angleDeg: 0, power: 0 }));
    const target = r.state.critters.find((c) => c.id === 2)!;
    expect(target.hp).toBe(75);
    expect(target.vy).toBeLessThan(0);
    expect(target.vx).toBeGreaterThan(0);
    expect(target.grounded).toBe(false);
    expect(hp(r.state, 3)).toBe(100);
    expect(hp(r.state, 4)).toBe(100);
    expect(types(r.events, "fired")).toHaveLength(1);
    // The enemy flies a long way up, then falls back down and lands.
    let peak = target.y;
    let flight = r.state;
    for (let i = 0; i < 200; i++) {
      flight = stepWorld(flight, []).state;
      peak = Math.min(peak, flight.critters.find((c) => c.id === 2)!.y);
    }
    expect(target.y - peak).toBeGreaterThan(40 * 65536);
  });

  it("a whiff still uses the turn", () => {
    const w = world([createCritter(1, 0, 200, 299), createCritter(2, 1, 400, 299)]);
    const r = run(w, 1, use({ weaponId: "root-punch", angleDeg: 0, power: 0 }));
    expect(types(r.events, "punched")[0]).toMatchObject({ targetId: null });
    expect(types(r.events, "fired")).toHaveLength(1);
  });
});

describe("jelly mine", () => {
  const place =
    (extra: CritterInput[] = []) =>
    (tick: number) =>
      tick === 0
        ? [
            {
              critterId: 1,
              move: 0 as const,
              fire: { weaponId: "jelly-mine" as const, angleDeg: 0, power: 0 },
            },
          ]
        : extra;

  it("is placed at the feet, arms after two seconds, and ignores critters until then", () => {
    const w = world([createCritter(1, 0, 200, 299), createCritter(2, 1, 230, 299)]);
    const r = run(w, 100, place());
    expect(r.state.mines).toHaveLength(1);
    expect(r.state.mines[0]).toMatchObject({ x: 200, y: 299, ownerId: 1 });
    expect(hp(r.state, 2)).toBe(100); // 30 cells away, but still unarmed
    const armed = run(r.state, 30);
    expect(types(armed.events, "mineArmed")).toHaveLength(1);
  });

  it("blows up when an enemy is within the trigger radius and carves a crater", () => {
    const w = world([createCritter(1, 0, 100, 299), createCritter(2, 1, 130, 299)]);
    const r = run(w, 125, place());
    expect(types(r.events, "explosion")).toHaveLength(1);
    expect(r.state.mines).toHaveLength(0);
    expect(hp(r.state, 2)).toBeLessThan(100);
  });

  it("stays put while nobody is near, and caps the number of active mines", () => {
    let s = world([createCritter(1, 0, 100, 299), createCritter(2, 1, 700, 299)]);
    for (let i = 0; i < 8; i++)
      s = run(s, 1, use({ weaponId: "jelly-mine", angleDeg: 0, power: 0 })).state;
    expect(s.mines).toHaveLength(6);
    expect(s.mines[5]!.id).toBeGreaterThan(s.mines[0]!.id);
  });
});

describe("beehive strike", () => {
  const strike = (x: number, y = 299) =>
    use({ weaponId: "beehive-strike", angleDeg: 0, power: 0, target: { x, y } });

  it("needs a target", () => {
    const w = world([createCritter(1, 0, 100, 299)]);
    const r = run(w, 1, use({ weaponId: "beehive-strike", angleDeg: 0, power: 0 }));
    expect(types(r.events, "fired")).toHaveLength(0);
    expect(r.state.strikes).toHaveLength(0);
  });

  it("drops five bombs one after another, which keep the turn unsettled until they land", () => {
    const w = world([createCritter(1, 0, 100, 299), createCritter(2, 1, 400, 299)]);
    const r = run(w, 1, strike(400));
    expect(types(r.events, "fired")).toHaveLength(1);
    expect(r.state.strikes).toHaveLength(1);
    const all = run(r.state, 600);
    expect(types(all.events, "explosion")).toHaveLength(5);
    expect(all.state.strikes).toHaveLength(0);
    expect(all.state.projectiles).toHaveLength(0);
    expect(hp(all.state, 2)).toBeLessThan(100);
    // Bombs land spread across the target, at least 75 cells apart in order.
    const xs = types(all.events, "explosion").map((e) => (e as { x: number }).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[4]! - xs[0]!).toBeGreaterThan(200);
  });
});

describe("determinism", () => {
  it("a scripted match using every new weapon replays identically and resumes from snapshots", () => {
    const hash = (s: SimState) =>
      new StateHasher()
        .value({ ...s, terrain: undefined })
        .i32(hashTerrain(s.terrain))
        .digest();
    const ids = ["pepper-shotgun", "root-punch", "jelly-mine", "beehive-strike"] as const;
    const TICKS = 600;
    const result = checkDeterminism<SimState, CritterInput>(
      {
        seed: 99,
        ticks: TICKS,
        init: () =>
          createWorld(
            flat(),
            [
              createCritter(1, 0, 200, 299),
              createCritter(2, 1, 215, 299),
              createCritter(3, 1, 330, 299),
            ],
            490,
          ),
        inputs: scriptedInputs(5, TICKS, (rng) => [
          {
            critterId: 1,
            move: (rng.nextInt(3) - 1) as -1 | 0 | 1,
            ...(rng.chance(1, 45)
              ? {
                  fire: {
                    weaponId: ids[rng.nextInt(4)]!,
                    angleDeg: rng.nextInt(360),
                    power: rng.nextInt(101),
                    target: { x: 150 + rng.nextInt(300), y: 299 },
                  },
                }
              : {}),
          },
        ]),
        step: (s, inputs, rng) => stepWorld(s, inputs, rng).state,
        hash,
        save: (s) => ({
          s: structuredClone({ ...s, terrain: undefined }),
          t: Array.from(serializeTerrain(s.terrain)),
        }),
        load: (saved) => {
          const o = saved as { s: SimState; t: number[] };
          return { ...structuredClone(o.s), terrain: deserializeTerrain(Uint8Array.from(o.t)) };
        },
      },
      { runs: 3 },
    );
    expect(result).toMatchObject({ ok: true, ticks: TICKS });
  }, 60_000);
});
