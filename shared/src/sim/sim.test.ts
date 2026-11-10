import { describe, expect, it } from "vitest";
import { toFixed } from "../fixed";
import { carveCircle, createDemoTerrain, createTerrain, DIRT } from "../terrain";
import type { CritterInput, SimEvent, SimState } from "./index";
import {
  BACKFLIP_VX,
  createCritter,
  createWorld,
  FALL_SAFE_DISTANCE,
  findSurfaceY,
  stepWorld,
  WALK_SPEED,
} from "./index";

/** Flat floor with its top solid row at `floorY`, 400 wide. */
function flatWorld(floorY = 200, height = 400) {
  const t = createTerrain(400, height);
  for (let y = floorY; y < height; y++) for (let x = 0; x < 400; x++) t.cells[y * 400 + x] = DIRT;
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

const left = { critterId: 1, move: -1 as const };
const right = { critterId: 1, move: 1 as const };

describe("walking", () => {
  it("settles onto the ground then walks right at WALK_SPEED", () => {
    const t = flatWorld(200);
    const w = createWorld(t, [createCritter(1, 0, 100, 190)], 390);
    const settled = run(w, 30).state;
    const c0 = settled.critters[0]!;
    expect(c0.grounded).toBe(true);
    expect(c0.y).toBe(toFixed(199));
    const walked = run(settled, 60, () => [right]).state.critters[0]!;
    expect(walked.x - c0.x).toBe(60 * WALK_SPEED);
    expect(walked.y).toBe(toFixed(199));
    expect(walked.facing).toBe(1);
  });

  it("faces left when walking left", () => {
    const t = flatWorld();
    const s = run(createWorld(t, [createCritter(1, 0, 100, 199)], 390), 5, () => [left]).state;
    expect(s.critters[0]!.facing).toBe(-1);
    expect(s.critters[0]!.x).toBeLessThan(toFixed(100));
  });

  it("climbs a gentle slope but is stopped by a wall", () => {
    const t = flatWorld(200);
    // 1-cell steps every 3 cells to the right of x=120: a gentle slope.
    for (let x = 120; x < 400; x++) {
      const top = 200 - Math.floor((x - 120) / 3);
      for (let y = top; y < 200; y++) t.cells[y * 400 + x] = DIRT;
    }
    const w = run(createWorld(t, [createCritter(1, 0, 100, 199)], 390), 200, () => [right]).state
      .critters[0]!;
    expect(w.y).toBeLessThan(toFixed(199)); // went up the slope
    expect(w.grounded).toBe(true);

    // A 30-cell tall wall blocks walking.
    const t2 = flatWorld(200);
    for (let y = 170; y < 200; y++) for (let x = 150; x < 400; x++) t2.cells[y * 400 + x] = DIRT;
    const blocked = run(createWorld(t2, [createCritter(1, 0, 100, 199)], 390), 300, () => [right])
      .state.critters[0]!;
    expect(blocked.x).toBeLessThan(toFixed(150));
    expect(blocked.y).toBe(toFixed(199));
  });

  it("walks across the bumpy demo terrain without getting stuck", () => {
    const t = createDemoTerrain();
    const w = createWorld(t, [createCritter(1, 0, 500, findSurfaceY(t, 500))], 984);
    const c = run(w, 300, () => [right]).state.critters[0]!;
    expect(c.status).toBe("alive");
    expect(c.grounded).toBe(true);
    expect(c.x).toBeGreaterThan(toFixed(500 + 150));
  });

  it("falls off a ledge when walking past the edge", () => {
    const t = flatWorld(200);
    carveCircle(t, 200, 200, 0); // no-op sanity
    for (let y = 200; y < 400; y++) for (let x = 150; x < 400; x++) t.cells[y * 400 + x] = 0;
    for (let y = 300; y < 400; y++) for (let x = 150; x < 400; x++) t.cells[y * 400 + x] = DIRT;
    const s = run(createWorld(t, [createCritter(1, 0, 140, 199)], 390), 120, () => [right]);
    const c = s.state.critters[0]!;
    expect(c.y).toBeGreaterThan(toFixed(250));
    expect(s.events.some((e) => e.type === "landed")).toBe(true);
  });
});

describe("jumping", () => {
  it("jumps forward and lands on the same height", () => {
    const t = flatWorld(200);
    const start = run(createWorld(t, [createCritter(1, 0, 100, 199)], 390), 5).state;
    const r = run(start, 80, (i) => (i === 0 ? [{ critterId: 1, move: 0, jump: true }] : []));
    const c = r.state.critters[0]!;
    expect(r.events.filter((e) => e.type === "jumped")).toHaveLength(1);
    expect(c.grounded).toBe(true);
    expect(c.y).toBe(toFixed(199));
    expect(c.x).toBeGreaterThan(toFixed(100));
  });

  it("backflips backwards and higher than a jump", () => {
    const t = flatWorld(200);
    const start = run(createWorld(t, [createCritter(1, 0, 200, 199)], 390), 5).state;
    const peak = (input: CritterInput) => {
      let s = start;
      let min = s.critters[0]!.y;
      for (let i = 0; i < 80; i++) {
        s = stepWorld(s, i === 0 ? [input] : []).state;
        if (s.critters[0]!.y < min) min = s.critters[0]!.y;
      }
      return { end: s.critters[0]!, min };
    };
    const j = peak({ critterId: 1, move: 0, jump: true });
    const b = peak({ critterId: 1, move: 0, backflip: true });
    expect(b.end.x).toBeLessThan(toFixed(200));
    expect(b.min).toBeLessThan(j.min);
    expect(BACKFLIP_VX).toBeGreaterThan(0);
  });

  it("cannot jump in mid air", () => {
    const t = flatWorld(300);
    const w = createWorld(t, [createCritter(1, 0, 100, 100)], 390);
    const r = run(w, 10, () => [{ critterId: 1, move: 0, jump: true }]);
    expect(r.events.filter((e) => e.type === "jumped")).toHaveLength(0);
  });
});

describe("fall damage and water", () => {
  it("takes no damage for a short fall", () => {
    const t = flatWorld(200);
    const w = createWorld(t, [createCritter(1, 0, 100, 200 - FALL_SAFE_DISTANCE + 10)], 390);
    const r = run(w, 120);
    expect(r.state.critters[0]!.hp).toBe(100);
    expect(r.events.some((e) => e.type === "damage")).toBe(false);
  });

  it("takes (distance - safe) / 2 damage for a longer fall", () => {
    const t = flatWorld(300);
    const w = createWorld(t, [createCritter(1, 0, 100, 150)], 390);
    const r = run(w, 200);
    const landed = r.events.find((e) => e.type === "landed");
    expect(landed).toBeDefined();
    const dist = (landed as Extract<SimEvent, { type: "landed" }>).fallDistance;
    expect(dist).toBeGreaterThan(FALL_SAFE_DISTANCE);
    const dmg = r.events.find((e) => e.type === "damage") as Extract<SimEvent, { type: "damage" }>;
    expect(dmg.amount).toBe(Math.floor((dist - FALL_SAFE_DISTANCE) / 2));
    expect(r.state.critters[0]!.hp).toBe(100 - dmg.amount);
  });

  it("dies from a lethal fall", () => {
    const t = createTerrain(400, 600);
    for (let y = 550; y < 600; y++) for (let x = 0; x < 400; x++) t.cells[y * 400 + x] = DIRT;
    const w = createWorld(t, [createCritter(1, 0, 100, 10)], 590);
    const r = run(w, 400);
    expect(r.state.critters[0]!.status).toBe("dead");
    expect(r.state.critters[0]!.hp).toBe(0);
    expect(r.events.some((e) => e.type === "died" && e.cause === "fall")).toBe(true);
  });

  it("drowns below the water line", () => {
    const t = flatWorld(350, 400);
    const w = createWorld(t, [createCritter(1, 0, 100, 100)], 250);
    const r = run(w, 200);
    expect(r.state.critters[0]!.status).toBe("drowned");
    expect(r.events.some((e) => e.type === "died" && e.cause === "water")).toBe(true);
  });
});

describe("purity and determinism", () => {
  it("does not mutate its input state and repeats exactly", () => {
    const t = flatWorld(200);
    const w = createWorld(t, [createCritter(1, 0, 100, 150), createCritter(2, 1, 300, 150)], 390);
    const frozen = JSON.stringify(w.critters);
    const a = run(w, 100, (i) => [i % 40 === 0 ? { critterId: 1, move: 1, jump: true } : right]);
    expect(JSON.stringify(w.critters)).toBe(frozen);
    const b = run(w, 100, (i) => [i % 40 === 0 ? { critterId: 1, move: 1, jump: true } : right]);
    expect(JSON.stringify(a.state.critters)).toBe(JSON.stringify(b.state.critters));
    expect(a.state.tick).toBe(100);
  });
});

describe("findSurfaceY", () => {
  it("finds the cell above the topmost solid", () => {
    expect(findSurfaceY(flatWorld(200), 50)).toBe(199);
  });
});
