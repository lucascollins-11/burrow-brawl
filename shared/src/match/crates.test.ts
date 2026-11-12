import { describe, expect, it } from "vitest";
import { Prng } from "../determinism";
import { FIXED_ONE } from "../fixed";
import { applyEdit, flatSlab } from "../sim3d/terrainOps";
import { createCritter } from "../sim3d/world";
import { CRATE_HEAL, collectCrates, dropCrate, settleCrates, touches, type Crate } from "./crates";
import { createMatch, hashMatch, loadMatch, mapRecipeFor, saveMatch, stepMatch } from "./match";
import type { MatchConfig, MatchState } from "./match";

const GROUND = 20;
const slab = () => flatSlab(96, 64, 96, GROUND, 4);
const crate = (over: Partial<Crate> = {}): Crate => ({
  id: 1,
  kind: "health",
  weaponId: "",
  x: 40,
  y: GROUND,
  z: 40,
  ...over,
});

describe("crates", () => {
  it("drops on dry land, the same for the same seed", () => {
    const a = dropCrate(slab(), 4, Prng.fromSeed(5), 7, ["fizz-grenade"]);
    const b = dropCrate(slab(), 4, Prng.fromSeed(5), 7, ["fizz-grenade"]);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.y).toBe(GROUND);
    expect(a!.id).toBe(7);
    if (a!.kind === "weapon") expect(a!.weaponId).toBe("fizz-grenade");
    else expect(a!.weaponId).toBe("");
  });

  it("finds nowhere to drop when the map is under the soda", () => {
    expect(dropCrate(slab(), GROUND + 5, Prng.fromSeed(5), 1, [])).toBeNull();
  });

  it("only gives snack boxes when there are no limited weapons", () => {
    for (let seed = 1; seed < 20; seed++)
      expect(dropCrate(slab(), 4, Prng.fromSeed(seed), 1, [])!.kind).toBe("health");
  });

  it("falls when the ground under it is blown away, and sinks in the soda", () => {
    const t = slab();
    let crates = [crate()];
    expect(settleCrates(t, 4, crates).crates[0]!.y).toBe(GROUND);
    applyEdit(t, { op: "carve", x: 40, y: GROUND - 2, z: 40, r: 5 });
    for (let i = 0; i < 20; i++) crates = settleCrates(t, 4, crates).crates;
    expect(crates[0]!.y).toBeLessThan(GROUND);
    expect(crates[0]!.y).toBeGreaterThan(4);
    // With the soda risen over it, the crate is lost.
    const r = settleCrates(t, GROUND + 1, crates);
    expect(r.crates).toHaveLength(0);
    expect(r.lost).toHaveLength(1);
  });

  it("is taken by a living critter that touches it, the lowest id first", () => {
    const near = createCritter(2, 0, 41, GROUND, 40);
    const also = createCritter(1, 1, 39, GROUND, 41);
    const far = createCritter(3, 0, 60, GROUND, 40);
    expect(touches(near, crate())).toBe(true);
    expect(touches(far, crate())).toBe(false);
    expect(touches({ ...near, status: "dead" }, crate())).toBe(false);
    expect(touches({ ...near, pos: { ...near.pos, y: (GROUND + 12) * FIXED_ONE } }, crate())).toBe(
      false,
    );
    const r = collectCrates([crate(), crate({ id: 2, x: 80 })], [near, also, far]);
    expect(r.taken).toEqual([{ crate: crate(), critterId: 1 }]);
    expect(r.crates.map((c) => c.id)).toEqual([2]);
  });
});

describe("crates in a match", () => {
  const cfg: MatchConfig = {
    seed: 77,
    teamSizes: [1, 1],
    turnTicks: 300,
    retreatTicks: 60,
    settleCapTicks: 600,
    startHealth: 100,
    windMax: 50,
    map: mapRecipeFor(77, 2),
  };
  const settle = (s: MatchState, ticks = 5): MatchState => {
    for (let i = 0; i < ticks; i++) s = stepMatch(cfg, s, []).state;
    return s;
  };

  it("a snack box heals the critter standing on it, up to full health", () => {
    let s = settle(createMatch(cfg));
    const c = s.sim.critters[0]!;
    const at = { x: c.pos.x >> 16, y: c.pos.y >> 16, z: c.pos.z >> 16 };
    s = {
      ...s,
      sim: {
        ...s.sim,
        critters: s.sim.critters.map((k) => (k.id === c.id ? { ...k, hp: 50 } : k)),
      },
      crates: [crate({ ...at })],
    };
    const r = stepMatch(cfg, s, []);
    expect(r.state.crates).toHaveLength(0);
    expect(r.state.sim.critters[0]!.hp).toBe(50 + CRATE_HEAL);
    const taken = r.events.find((e) => e.type === "crateTaken");
    expect(taken).toMatchObject({ critterId: c.id, kind: "health", amount: CRATE_HEAL });
    // At 90 health the same box only tops up to 100.
    const s2 = {
      ...s,
      sim: {
        ...s.sim,
        critters: s.sim.critters.map((k) => (k.id === c.id ? { ...k, hp: 90 } : k)),
      },
    };
    expect(stepMatch(cfg, s2, []).state.sim.critters[0]!.hp).toBe(100);
  });

  it("a weapon crate adds a shot for the taker's team only", () => {
    let s = settle(createMatch(cfg));
    const c = s.sim.critters[0]!;
    const before = s.ammo[c.team]!["fizz-grenade"]!;
    s = {
      ...s,
      crates: [
        crate({
          kind: "weapon",
          weaponId: "fizz-grenade",
          x: c.pos.x >> 16,
          y: c.pos.y >> 16,
          z: c.pos.z >> 16,
        }),
      ],
    };
    const r = stepMatch(cfg, s, []);
    expect(r.state.ammo[c.team]!["fizz-grenade"]).toBe(before + 1);
    expect(r.state.ammo[1 - c.team]!["fizz-grenade"]).toBe(before);
  });

  it("drops crates as turns pass, the same in every run, and keeps them in snapshots", () => {
    const play = (): { state: MatchState; dropped: number } => {
      let s = createMatch(cfg);
      let dropped = 0;
      for (let i = 0; i < 4000; i++) {
        const r = stepMatch(cfg, s, []);
        s = r.state;
        dropped += r.events.filter((e) => e.type === "crateDropped").length;
      }
      return { state: s, dropped };
    };
    const a = play();
    const b = play();
    expect(a.dropped).toBeGreaterThan(0);
    expect(a.state.crates.length).toBeLessThanOrEqual(6);
    expect(hashMatch(a.state)).toBe(hashMatch(b.state));
    const back = loadMatch(cfg, JSON.parse(JSON.stringify(saveMatch(a.state))));
    expect(back.crates).toEqual(a.state.crates);
    expect(hashMatch(back)).toBe(hashMatch(a.state));
  });
});
