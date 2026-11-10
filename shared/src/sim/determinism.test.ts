import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs, StateHasher } from "../determinism";
import {
  carveCircle,
  createDemoTerrain,
  deserializeTerrain,
  hashTerrain,
  serializeTerrain,
} from "../terrain";
import type { CritterInput, SimState } from "./index";
import { createCritter, createWorld, findSurfaceY, stepWorld } from "./index";

/** Hash of everything that matters: all sim state plus the terrain mask. */
function simHash(s: SimState): number {
  return new StateHasher()
    .value({
      tick: s.tick,
      waterY: s.waterY,
      wind: s.wind,
      nextProjectileId: s.nextProjectileId,
      critters: s.critters,
      projectiles: s.projectiles,
      mines: s.mines,
      strikes: s.strikes,
      burst: s.burst,
    })
    .i32(hashTerrain(s.terrain))
    .digest();
}

function save(s: SimState): unknown {
  return {
    tick: s.tick,
    waterY: s.waterY,
    critters: s.critters,
    projectiles: s.projectiles,
    mines: s.mines,
    strikes: s.strikes,
    burst: s.burst,
    nextProjectileId: s.nextProjectileId,
    wind: s.wind,
    terrain: Array.from(serializeTerrain(s.terrain)),
  };
}

function load(saved: unknown): SimState {
  const o = saved as {
    tick: number;
    waterY: number;
    critters: SimState["critters"];
    projectiles: SimState["projectiles"];
    nextProjectileId: number;
    mines: SimState["mines"];
    strikes: SimState["strikes"];
    burst: SimState["burst"];
    wind: number;
    terrain: number[];
  };
  return {
    tick: o.tick,
    waterY: o.waterY,
    critters: o.critters,
    projectiles: o.projectiles,
    nextProjectileId: o.nextProjectileId,
    mines: o.mines,
    strikes: o.strikes,
    burst: o.burst,
    wind: o.wind,
    terrain: deserializeTerrain(Uint8Array.from(o.terrain)),
  };
}

describe("sim determinism", () => {
  it("replays identically from the same seed and inputs, and resumes from snapshots", () => {
    const TICKS = 600;
    const result = checkDeterminism<SimState, CritterInput>(
      {
        seed: 1234,
        ticks: TICKS,
        init: () => {
          const t = createDemoTerrain(256, 128);
          carveCircle(t, 128, 60, 14); // a crater to fall into
          return createWorld(
            t,
            [
              createCritter(1, 0, 50, findSurfaceY(t, 50)),
              createCritter(2, 1, 200, findSurfaceY(t, 200)),
            ],
            110,
          );
        },
        inputs: scriptedInputs(7, TICKS, (rng) => [
          {
            critterId: 1,
            move: (rng.nextInt(3) - 1) as -1 | 0 | 1,
            jump: rng.chance(1, 40),
            backflip: rng.chance(1, 80),
          },
          { critterId: 2, move: (rng.nextInt(3) - 1) as -1 | 0 | 1, jump: rng.chance(1, 50) },
        ]),
        step: (s, inputs, rng) => stepWorld(s, inputs, rng).state,
        hash: simHash,
        save,
        load,
      },
      { runs: 3 },
    );
    expect(result).toMatchObject({ ok: true, ticks: TICKS });
  }, 30_000);
});
