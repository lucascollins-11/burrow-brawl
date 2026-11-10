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
  const { terrain, ...rest } = s;
  return new StateHasher().value(rest).i32(hashTerrain(terrain)).digest();
}

function save(s: SimState): unknown {
  const { terrain, ...rest } = s;
  return { ...structuredClone(rest), terrain: Array.from(serializeTerrain(terrain)) };
}

function load(saved: unknown): SimState {
  const { terrain, ...rest } = saved as Omit<SimState, "terrain"> & { terrain: number[] };
  return { ...rest, terrain: deserializeTerrain(Uint8Array.from(terrain)) } as SimState;
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
