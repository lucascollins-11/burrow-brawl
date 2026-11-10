import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs } from "../determinism";
import { basicTurns } from "../sim/turns";
import { fromBase64, toBase64 } from "./base64";
import {
  createMatch,
  hashMatch,
  isCmd,
  loadMatch,
  saveMatch,
  stepMatch,
  type Cmd,
  type MatchConfig,
  type MatchState,
} from "./match";
import { MatchMirror } from "./mirror";

const cfg: MatchConfig = {
  seed: 77,
  teamSizes: [2, 2],
  turnTicks: 300,
  retreatTicks: 60,
  settleCapTicks: 600,
  startHealth: 100,
  windMax: 50,
  mapWidth: 512,
  mapHeight: 256,
};

function run(
  state: MatchState,
  ticks: number,
  cmdsAt: (t: number) => Cmd[] = () => [],
): MatchState {
  for (let i = 0; i < ticks; i++) state = stepMatch(cfg, state, cmdsAt(state.sim.tick + 1)).state;
  return state;
}

describe("base64", () => {
  it("round-trips all lengths", () => {
    for (let n = 0; n < 10; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
    expect(toBase64(new TextEncoder().encode("Molekin"))).toBe("TW9sZWtpbg==");
    expect(() => fromBase64("abc")).toThrow();
    expect(() => fromBase64("ab!d")).toThrow();
  });
});

describe("match model", () => {
  it("creates the same match from the same config", () => {
    const a = createMatch(cfg);
    const b = createMatch(cfg);
    expect(hashMatch(a)).toBe(hashMatch(b));
    expect(hashMatch(createMatch({ ...cfg, seed: 78 }))).not.toBe(hashMatch(a));
    expect(a.sim.critters.map((c) => c.team)).toEqual([0, 1, 0, 1]);
    expect(a.turns).toMatchObject({ turn: 1, round: 1, phase: "control", activeTeam: 0 });
  });

  it("is deterministic under scripted commands, with snapshot resume", () => {
    // Small map and fewer ticks: the harness hashes the whole map every tick.
    const small: MatchConfig = { ...cfg, mapWidth: 384, mapHeight: 160, turnTicks: 120 };
    const ticks = 500;
    const r = checkDeterminism<MatchState, Cmd>({
      seed: 1,
      ticks,
      init: () => createMatch(small),
      inputs: scriptedInputs(5, ticks, (rng): Cmd[] => {
        const roll = rng.nextInt(40);
        if (roll === 0) return [{ k: "jump" }];
        if (roll === 1) return [{ k: "backflip" }];
        if (roll === 2) return [{ k: "move", dir: rng.pick([-1, 0, 1] as const) }];
        if (roll === 3 && rng.chance(1, 8)) return [{ k: "skip" }];
        return [];
      }),
      step: (s, cmds) => stepMatch(small, s, cmds).state,
      hash: hashMatch,
      save: (s) => saveMatch(s),
      load: (snap) => loadMatch(snap as ReturnType<typeof saveMatch>),
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("held move applies only to the active critter and resets on a new turn", () => {
    let s = createMatch(cfg);
    s = run(s, 30); // land
    const active = s.turns.activeCritter!;
    const x0 = s.sim.critters.find((c) => c.id === active)!.x;
    s = stepMatch(cfg, s, [{ k: "move", dir: 1 }]).state;
    s = run(s, 20);
    expect(s.sim.critters.find((c) => c.id === active)!.x).not.toBe(x0);
    expect(s.move).toBe(1);
    s = stepMatch(cfg, s, [{ k: "skip" }]).state;
    // Settled right away (everyone grounded), so team 1 is up and the held move is gone.
    expect(s.turns).toMatchObject({ turn: 2, activeTeam: 1, phase: "control" });
    expect(basicTurns.activeTeam(s.turns)).toBe(1);
    expect(s.move).toBe(0);
  });

  it("fire starts retreat, then the turn ends on the retreat timer", () => {
    let s = run(createMatch(cfg), 30);
    s = stepMatch(cfg, s, [{ k: "fire", weapon: "acorn-mortar", angle: 45, power: 50 }]).state;
    expect(s.turns.phase).toBe("retreat");
    s = run(s, 61);
    expect(s.turns.phase).not.toBe("retreat");
  });

  it("fire launches a real projectile that explodes, and the turn waits for it before ending", () => {
    let s = run(createMatch(cfg), 30);
    // Lob toward the middle of the map so the shot lands on the terrain instead of leaving it.
    const me = s.sim.critters.find((c) => c.id === s.turns.activeCritter)!;
    const angle = me.x >> 16 < cfg.mapWidth / 2 ? 55 : 125;
    s = stepMatch(cfg, s, [{ k: "fire", weapon: "acorn-mortar", angle, power: 35 }]).state;
    expect(s.sim.projectiles).toHaveLength(1);
    expect(s.turns.phase).toBe("retreat");
    const turn = s.turns.turn;
    let exploded = false;
    let waitedForShot = false;
    for (let i = 0; i < 1500 && s.turns.turn === turn; i++) {
      const r = stepMatch(cfg, s, []);
      s = r.state;
      if (r.events.some((e) => e.type === "explosion")) exploded = true;
      if (s.turns.phase === "settling" && s.sim.projectiles.length > 0) waitedForShot = true;
    }
    expect(exploded || s.sim.projectiles.length === 0).toBe(true);
    expect(s.sim.projectiles).toHaveLength(0);
    expect(waitedForShot || exploded).toBe(true);
    expect(s.turns.turn).toBe(turn + 1);
  });

  it("copies the turn's wind into the sim and re-rolls it each turn", () => {
    let s = createMatch(cfg);
    expect(s.sim.wind).toBe(s.turns.wind);
    const winds = new Set<number>([s.turns.wind]);
    for (let i = 0; i < 6; i++) {
      const turn = s.turns.turn;
      while (s.turns.turn === turn) s = stepMatch(cfg, s, [{ k: "skip" }]).state;
      expect(s.sim.wind).toBe(s.turns.wind);
      expect(Math.abs(s.turns.wind)).toBeLessThanOrEqual(cfg.windMax);
      winds.add(s.turns.wind);
    }
    expect(winds.size).toBeGreaterThan(1);
  });

  it("raises the soda every turn once sudden death starts", () => {
    const sd: MatchConfig = { ...cfg, suddenDeathRound: 1, waterRisePerTurn: 10 };
    let s = createMatch(sd);
    const start = s.sim.waterY;
    // Round 1 turns do not raise the soda; later rounds do.
    while (s.turns.round === 1) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.waterY).toBeLessThan(start);
    const before = s.sim.waterY;
    const turn = s.turns.turn;
    while (s.turns.turn === turn) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.waterY).toBe(before - 10);
  });

  it("snapshots round-trip with projectiles in flight", () => {
    let s = run(createMatch(cfg), 30);
    s = stepMatch(cfg, s, [
      { k: "fire", weapon: "fizz-grenade", angle: 30, power: 60, fuse: 3 },
    ]).state;
    s = run(s, 20);
    expect(s.sim.projectiles.length).toBe(1);
    const back = loadMatch(JSON.parse(JSON.stringify(saveMatch(s))));
    expect(hashMatch(back)).toBe(hashMatch(s));
    expect(hashMatch(run(back, 100))).toBe(hashMatch(run(s, 100)));
  });

  it("times out turns and rotates teams and critters", () => {
    let s = createMatch(cfg);
    const seen: Array<[number | null, number | null]> = [];
    for (let i = 0; i < 4; i++) {
      seen.push([s.turns.activeTeam, s.turns.activeCritter]);
      const turn = s.turns.turn;
      while (s.turns.turn === turn) s = stepMatch(cfg, s, []).state;
    }
    expect(seen.map((x) => x[0])).toEqual([0, 1, 0, 1]);
    expect(new Set(seen.map((x) => x[1])).size).toBe(4);
    expect(s.turns.round).toBe(3);
  });

  it("ends the match when one team is left", () => {
    let s = run(createMatch(cfg), 30);
    s = {
      ...s,
      sim: {
        ...s.sim,
        critters: s.sim.critters.map((c) =>
          c.team === 1 ? { ...c, status: "drowned" as const } : c,
        ),
      },
    };
    s = stepMatch(cfg, s, [{ k: "skip" }]).state;
    s = run(s, 5);
    expect(s.turns).toMatchObject({ phase: "over", winnerTeam: 0 });
  });

  it("validates commands", () => {
    expect(isCmd({ k: "move", dir: 1 })).toBe(true);
    expect(isCmd({ k: "move", dir: 2 })).toBe(false);
    expect(isCmd({ k: "jump", extra: 1 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "acorn-mortar", angle: 45, power: 50 })).toBe(true);
    expect(isCmd({ k: "fire", weapon: "fizz-grenade", angle: 0, power: 100, fuse: 3 })).toBe(true);
    expect(isCmd({ k: "fire", weapon: "acorn-mortar", angle: 45 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "skip-turn", angle: 45, power: 50 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "acorn-mortar", angle: 45.5, power: 50 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "acorn-mortar", angle: 360, power: 50 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "acorn-mortar", angle: 45, power: 101 })).toBe(false);
    expect(isCmd({ k: "fire", weapon: "fizz-grenade", angle: 45, power: 5, fuse: 9 })).toBe(false);
    expect(isCmd({ k: "teleport" })).toBe(false);
    expect(isCmd(null)).toBe(false);
  });
});

describe("MatchMirror", () => {
  it("follows relayed commands, stops at the confirmed tick, and checks hashes", () => {
    let server = createMatch(cfg);
    const mirror = new MatchMirror(cfg, saveMatch(server));
    const script = new Map<number, Cmd[]>([
      [40, [{ k: "move", dir: 1 }]],
      [80, [{ k: "jump" }]],
      [120, [{ k: "move", dir: 0 }]],
    ]);
    for (let t = 1; t <= 200; t++) {
      const cmds = script.get(t) ?? [];
      if (cmds.length) mirror.onInputs(t, cmds);
      server = stepMatch(cfg, server, cmds).state;
      if (t % 30 === 0) expect(mirror.onHash(t, hashMatch(server))).toBe(true);
      if (t === 100) {
        mirror.advance();
        expect(mirror.tick).toBe(90); // confirmed only up to the last hash
      }
    }
    mirror.onConfirmed(200);
    mirror.advance();
    expect(mirror.tick).toBe(200);
    expect(hashMatch(mirror.state)).toBe(hashMatch(server));
  });

  it("flags a desync and recovers from a snapshot", () => {
    let server = createMatch(cfg);
    const mirror = new MatchMirror(cfg, saveMatch(server));
    mirror.onInputs(10, [{ k: "move", dir: 1 }]); // the server never applied this
    for (let t = 1; t <= 60; t++) server = stepMatch(cfg, server, []).state;
    mirror.onConfirmed(60);
    mirror.advance();
    expect(mirror.onHash(60, hashMatch(server))).toBe(false);
    expect(mirror.desyncedAt).toBe(60);
    mirror.onSnapshot(saveMatch(server));
    expect(mirror.desyncedAt).toBeNull();
    expect(hashMatch(mirror.state)).toBe(hashMatch(server));
  });
});
