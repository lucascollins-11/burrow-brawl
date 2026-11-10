import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs, StateHasher } from "../determinism";
import { fromFixed } from "../fixed";
import { createTerrain, hashTerrain, setCell, type Terrain } from "../terrain";
import { CRITTER_HALF_WIDTH, CRITTER_HEIGHT } from "./constants";
import { createCritter, createWorld } from "./world";
import { stepWorld } from "./step";
import type { Critter, CritterInput, FireCommand, SimEvent, SimState } from "./types";
import { applyInstantWeapon, isInstantWeapon } from "./instant";

const CRUST = 1;
const FLOOR_ROW = 100;

/** 200 x 160 open air with a solid floor from FLOOR_ROW down. */
function floorTerrain(): Terrain {
  const t = createTerrain(200, 160);
  for (let y = FLOOR_ROW; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) setCell(t, x, y, CRUST);
  }
  return t;
}

function grounded(id: number, x: number, feet: number): Critter {
  return { ...createCritter(id, 0, x, feet), grounded: true };
}

function fire(critterId: number, cmd: FireCommand): CritterInput {
  return { critterId, move: 0, fire: cmd };
}

function run(c: Critter, cmd: FireCommand, t: Terrain): { critter: Critter; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const critter = applyInstantWeapon(t, c, cmd, events);
  return { critter, events };
}

const skip: FireCommand = { weaponId: "skip-turn", angleDeg: 0, power: 0 };
const boots = (angleDeg: number): FireCommand => ({ weaponId: "spring-boots", angleDeg, power: 0 });
const teleport = (x: number, y: number): FireCommand => ({
  weaponId: "teleport-burrow",
  angleDeg: 0,
  power: 0,
  target: { x, y },
});

describe("instant weapons", () => {
  it("recognises exactly the three instant weapons", () => {
    expect(isInstantWeapon("skip-turn")).toBe(true);
    expect(isInstantWeapon("teleport-burrow")).toBe(true);
    expect(isInstantWeapon("spring-boots")).toBe(true);
    expect(isInstantWeapon("acorn-mortar")).toBe(false);
  });

  describe("skip turn", () => {
    it("changes nothing on the critter and ends the turn", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      const { critter, events } = run(c, skip, t);
      expect(critter).toBe(c);
      expect(events).toEqual([{ type: "turnEnded", critterId: 1, weaponId: "skip-turn" }]);
    });
  });

  describe("teleport burrow", () => {
    it("moves the critter to a clear spot, stops it, and ends the turn", () => {
      const t = floorTerrain();
      const c = { ...createCritter(1, 0, 50, 80), vx: 500, vy: 300, grounded: false, peakY: 10 };
      const { critter, events } = run(c, teleport(120, 60), t);
      expect(fromFixed(critter.x)).toBe(120);
      expect(fromFixed(critter.y)).toBe(60);
      expect(critter.vx).toBe(0);
      expect(critter.vy).toBe(0);
      expect(critter.grounded).toBe(false);
      expect(critter.peakY).toBe(60);
      expect(events).toEqual([
        { type: "teleported", critterId: 1, x: 120, y: 60 },
        { type: "turnEnded", critterId: 1, weaponId: "teleport-burrow" },
      ]);
    });

    it("does nothing when the destination is inside terrain", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      const { critter, events } = run(c, teleport(120, FLOOR_ROW + 5), t);
      expect(critter).toBe(c);
      expect(events).toEqual([]);
    });

    it("does nothing when the destination is off the map or too close to an edge", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      expect(run(c, teleport(CRITTER_HALF_WIDTH - 1, 60), t).events).toEqual([]);
      expect(run(c, teleport(t.width, 60), t).events).toEqual([]);
      expect(run(c, teleport(120, CRITTER_HEIGHT - 1), t).events).toEqual([]);
      expect(run(c, teleport(120, t.height), t).events).toEqual([]);
    });

    it("does nothing without a whole-cell target", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      const bad: FireCommand = { ...teleport(0, 0), target: { x: 120.5, y: 60 } };
      expect(run(c, bad, t).events).toEqual([]);
      const none: FireCommand = { weaponId: "teleport-burrow", angleDeg: 0, power: 0 };
      expect(run(c, none, t).events).toEqual([]);
    });
  });

  describe("spring boots", () => {
    it("launches a grounded critter straight up with the jump speed", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      const { critter, events } = run(c, boots(90), t);
      expect(critter.grounded).toBe(false);
      expect(Math.abs(critter.vx)).toBeLessThan(1000);
      expect(critter.vy).toBeLessThan(-10 * 65536); // about 16 cells per tick up
      expect(events).toEqual([{ type: "springJumped", critterId: 1 }]);
    });

    it("sends the critter the way it aims, and clamps the angle to maxAngleDegrees", () => {
      const t = floorTerrain();
      const c = grounded(1, 50, FLOOR_ROW - 1);
      const right = run(c, boots(45), t).critter;
      expect(right.vx).toBeGreaterThan(0);
      expect(right.facing).toBe(1);
      const left = run(c, boots(135), t).critter;
      expect(left.vx).toBeLessThan(0);
      expect(left.facing).toBe(-1);
      // 0 degrees is clamped to 5 degrees (90 - 85), so it matches an aim of 5 exactly.
      const flat = run(c, boots(0), t).critter;
      expect(flat).toEqual(run(c, boots(5), t).critter);
      expect(flat.vy).toBeLessThan(0);
      expect(flat.vx).toBeGreaterThan(right.vx);
    });

    it("does nothing from the air", () => {
      const t = floorTerrain();
      const c = { ...createCritter(1, 0, 50, 40), grounded: false };
      const { critter, events } = run(c, boots(90), t);
      expect(critter).toBe(c);
      expect(events).toEqual([]);
    });

    it("does not end the turn", () => {
      const t = floorTerrain();
      const { events } = run(grounded(1, 50, FLOOR_ROW - 1), boots(90), t);
      expect(events.some((e) => e.type === "turnEnded")).toBe(false);
    });
  });

  describe("through stepWorld", () => {
    it("applies a teleport fired in the same tick as other input", () => {
      const t = floorTerrain();
      const state: SimState = createWorld(t, [grounded(1, 50, FLOOR_ROW - 1)], 150);
      const { state: next, events } = stepWorld(state, [fire(1, teleport(120, 60))]);
      expect(next.critters[0]?.x).toBe(createCritter(1, 0, 120, 60).x);
      expect(events.map((e) => e.type)).toContain("teleported");
      expect(events.map((e) => e.type)).not.toContain("fired");
    });
  });

  it("replays identically from the same seed and inputs, and resumes from snapshots", () => {
    const TICKS = 300;
    const weapons: FireCommand[] = [
      skip,
      boots(70),
      boots(110),
      teleport(60, 60),
      teleport(150, 70),
    ];
    const result = checkDeterminism<SimState, CritterInput>(
      {
        seed: 99,
        ticks: TICKS,
        init: () =>
          createWorld(
            floorTerrain(),
            [grounded(1, 40, FLOOR_ROW - 1), grounded(2, 160, FLOOR_ROW - 1)],
            150,
          ),
        inputs: scriptedInputs(5, TICKS, (rng) => {
          const pick = (): FireCommand => weapons[rng.nextInt(weapons.length)]!;
          return [
            {
              critterId: 1,
              move: (rng.nextInt(3) - 1) as -1 | 0 | 1,
              jump: rng.chance(1, 30),
              ...(rng.chance(1, 40) ? { fire: pick() } : {}),
            },
            {
              critterId: 2,
              move: (rng.nextInt(3) - 1) as -1 | 0 | 1,
              ...(rng.chance(1, 40) ? { fire: pick() } : {}),
            },
          ];
        }),
        step: (s, inputs, rng) => stepWorld(s, inputs, rng).state,
        hash: (s) =>
          new StateHasher()
            .value({ tick: s.tick, critters: s.critters, projectiles: s.projectiles })
            .i32(hashTerrain(s.terrain))
            .digest(),
      },
      { runs: 3 },
    );
    expect(result).toMatchObject({ ok: true, ticks: TICKS });
  }, 30_000);
});
