// ViewStream: what a view client is told about critters busy with a utility and placed mines.

import { describe, expect, it } from "vitest";
import { createMatch, stepMatch, type Cmd, type MatchState } from "@burrow-brawl/shared";
import { MatchRunner } from "./runner";
import { ViewStream } from "./view";

const cfg = MatchRunner.configFor(
  {
    turnSeconds: 30,
    retreatSeconds: 3,
    crittersPerTeam: 1,
    startHealth: 100,
    mapSeed: 7,
    windMax: 0,
  },
  2,
);

function run(s: MatchState, n: number, at?: number, cmds: Cmd[] = []): MatchState {
  for (let i = 0; i < n; i++) s = stepMatch(cfg, s, s.sim.tick + 1 === at ? cmds : []).state;
  return s;
}

describe("view stream", () => {
  it("shows a drilling critter with act: drill, and drops it when the drill stops", () => {
    let s = run(createMatch(cfg), 60);
    const v = new ViewStream(s);
    v.batch(s);
    const drill: Cmd = { k: "fire", weaponId: "drill-hat", yaw: 0, pitch: -60, power: 0 };
    s = run(s, 3, s.sim.tick + 1, [drill]);
    const id = s.turns.activeCritter;
    const busy = v.batch(s).find((m) => m.t === "state");
    expect(busy && "critters" in busy && busy.critters.find((c) => c.id === id)?.act).toBe("drill");
    s = run(s, 240);
    const done = v.fullState(s).critters.find((c) => c.id === id)!;
    expect(done.act).toBeUndefined();
  });

  it("shows Spring Boots as act: boots until the landing", () => {
    let s = run(createMatch(cfg), 60);
    const id = s.turns.activeCritter;
    const boots: Cmd = { k: "fire", weaponId: "spring-boots", yaw: 0, pitch: 80, power: 0 };
    s = run(s, 3, s.sim.tick + 1, [boots]);
    const v = new ViewStream(s);
    expect(v.fullState(s).critters.find((c) => c.id === id)!.act).toBe("boots");
    s = run(s, 400);
    expect(v.fullState(s).critters.find((c) => c.id === id)!.act).toBeUndefined();
  });

  it("lists a placed mine in mines, not projectiles, and arms it after its delay", () => {
    let s = run(createMatch(cfg), 60);
    const v = new ViewStream(s);
    const drop: Cmd = { k: "fire", weaponId: "jelly-mine", yaw: 0, pitch: 0, power: 0 };
    s = run(s, 3, s.sim.tick + 1, [drop]);
    let full = v.fullState(s);
    expect(full.projectiles).toHaveLength(0);
    expect(full.mines).toHaveLength(1);
    expect(full.mines![0]).toMatchObject({
      weaponId: "jelly-mine",
      armed: false,
      triggered: false,
    });
    s = run(s, 60 * 2);
    full = v.fullState(s);
    // Its placer still stands beside it, so once armed it is set off.
    expect(full.mines![0]).toMatchObject({ armed: true, triggered: true });
    expect(full.mines![0]!.fuseTicks).toBeGreaterThanOrEqual(0);
  });
});
