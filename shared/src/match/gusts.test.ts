import { describe, expect, it } from "vitest";
import { GUST_PERIOD, gustAmplitude, gustAt, isStorm, stormWindMax, windWithGust } from "./gusts";
import { createMatch, hashMatch, mapRecipeFor, stepMatch, type MatchConfig } from "./match";

const calm: MatchConfig = {
  seed: 91,
  teamSizes: [2, 2],
  turnTicks: 300,
  retreatTicks: 60,
  settleCapTicks: 600,
  startHealth: 100,
  windMax: 50,
  map: mapRecipeFor(91, 2),
};
const storm: MatchConfig = { ...calm, sky: { weather: "storm", time: "night" } };

describe("storm gusts", () => {
  it("only storms gust", () => {
    expect(isStorm(undefined)).toBe(false);
    expect(isStorm({ weather: "rain" })).toBe(false);
    expect(isStorm({ weather: "storm" })).toBe(true);
    expect(stormWindMax(50)).toBe(75);
    expect(stormWindMax(90)).toBe(100);
    expect(gustAmplitude(0)).toBe(0);
    expect(gustAt(5, 100, 0)).toEqual({ x: 0, z: 0 });
  });

  it("is a pure integer function of seed and tick, bounded by the amplitude", () => {
    const amp = gustAmplitude(50);
    let moved = 0;
    let lulls = 0;
    for (let t = 0; t < GUST_PERIOD * 60; t++) {
      const g = gustAt(1234, t, amp);
      expect(g).toEqual(gustAt(1234, t, amp));
      expect(Number.isInteger(g.x) && Number.isInteger(g.z)).toBe(true);
      expect(Math.abs(g.x)).toBeLessThanOrEqual(amp);
      expect(Math.abs(g.z)).toBeLessThanOrEqual(amp);
      const prev = gustAt(1234, t - 1, amp);
      // Gusts swell and fade, they never jump.
      if (t > 0) expect(Math.abs(g.x - prev.x) + Math.abs(g.z - prev.z)).toBeLessThanOrEqual(4);
      if (g.x !== prev.x || g.z !== prev.z) moved++;
      if (t % GUST_PERIOD === 0 && g.x === 0 && g.z === 0) lulls++;
    }
    expect(moved).toBeGreaterThan(GUST_PERIOD * 10);
    expect(lulls).toBeGreaterThan(3);
    expect(gustAt(1235, 400, amp)).not.toEqual(gustAt(1234, 400, amp));
  });

  it("clamps turn wind plus gust to the sim's range", () => {
    expect(windWithGust(90, -95, { x: 30, z: -30 })).toEqual({ windX: 100, windZ: -100 });
    expect(windWithGust(10, 5, { x: -3, z: 2 })).toEqual({ windX: 7, windZ: 7 });
  });

  it("leaves calm matches exactly as they were", () => {
    let a = createMatch(calm);
    let b = createMatch({ ...calm, sky: { weather: "rain", time: "dusk" } });
    expect(a.turns.gustX).toBeUndefined();
    for (let i = 0; i < 200; i++) {
      a = stepMatch(calm, a, []).state;
      b = stepMatch({ ...calm, sky: { weather: "rain", time: "dusk" } }, b, []).state;
    }
    expect(hashMatch(a)).toBe(hashMatch(b));
    expect([a.sim.windX, a.sim.windZ]).toEqual([a.turns.windX, a.turns.windZ]);
  });

  it("varies the sim's wind through a storm turn, the same on every run", () => {
    const play = (): { hash: number; winds: string[] } => {
      let s = createMatch(storm);
      const winds = new Set<string>();
      for (let i = 0; i < 250; i++) {
        s = stepMatch(storm, s, []).state;
        expect(s.turns.gustX).toBeDefined();
        const w = windWithGust(s.turns.windX, s.turns.windZ, {
          x: s.turns.gustX!,
          z: s.turns.gustZ!,
        });
        expect([s.sim.windX, s.sim.windZ]).toEqual([w.windX, w.windZ]);
        expect(Math.abs(s.turns.windX)).toBeLessThanOrEqual(stormWindMax(storm.windMax));
        winds.add(`${s.sim.windX},${s.sim.windZ}`);
      }
      return { hash: hashMatch(s), winds: [...winds] };
    };
    const one = play();
    expect(one.winds.length).toBeGreaterThan(20);
    expect(play()).toEqual(one);
  });

  it("no wind setting means no gusts, storm or not", () => {
    const still: MatchConfig = { ...storm, windMax: 0 };
    let s = createMatch(still);
    for (let i = 0; i < 120; i++) s = stepMatch(still, s, []).state;
    expect([s.sim.windX, s.sim.windZ]).toEqual([0, 0]);
  });
});
