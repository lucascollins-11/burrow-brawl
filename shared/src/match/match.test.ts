import { describe, expect, it } from "vitest";
import { isSolid } from "../terrain";
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
        if (roll === 4) {
          const weaponId = rng.pick(["acorn-mortar", "fizz-grenade"] as const);
          return [
            {
              k: "fire",
              weaponId,
              angleDeg: rng.nextInt(180),
              power: rng.nextRange(20, 100),
              fuseSeconds: 2,
            },
          ];
        }
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
    // Unsupported weapons do nothing; a real shot starts retreat.
    s = stepMatch(cfg, s, [
      { k: "fire", weaponId: "boulder-of-doom", angleDeg: 45, power: 50 },
    ]).state;
    expect(s.turns.phase).toBe("control");
    s = stepMatch(cfg, s, [{ k: "fire", weaponId: "acorn-mortar", angleDeg: 45, power: 50 }]).state;
    expect(s.turns.phase).toBe("retreat");
    expect(s.sim.projectiles).toHaveLength(1);
    // No second shot during retreat.
    s = stepMatch(cfg, s, [{ k: "fire", weaponId: "acorn-mortar", angleDeg: 45, power: 50 }]).state;
    expect(s.sim.projectiles.length).toBeLessThanOrEqual(1);
    s = run(s, 61);
    expect(s.turns.phase).not.toBe("retreat");
  });

  it("holds the turn open for shots in flight and copies wind into the sim", () => {
    let s = run(createMatch(cfg), 30);
    expect(s.sim.wind).toBe(s.turns.wind);
    const me = s.sim.critters.find((c) => c.id === s.turns.activeCritter)!;
    const angleDeg = me.x >> 16 < cfg.mapWidth / 2 ? 55 : 125;
    s = stepMatch(cfg, s, [{ k: "fire", weaponId: "acorn-mortar", angleDeg, power: 35 }]).state;
    expect(s.sim.projectiles).toHaveLength(1);
    const turn = s.turns.turn;
    let sawSettlingWithShot = false;
    for (let i = 0; i < 1500 && s.turns.turn === turn; i++) {
      s = stepMatch(cfg, s, []).state;
      if (s.turns.phase === "settling" && s.sim.projectiles.length > 0) sawSettlingWithShot = true;
    }
    expect(s.sim.projectiles).toHaveLength(0);
    expect(sawSettlingWithShot || s.turns.turn === turn + 1).toBe(true);
    expect(s.sim.wind).toBe(s.turns.wind);
  });

  it("raises the soda every turn once sudden death starts", () => {
    const sd: MatchConfig = { ...cfg, suddenDeathRound: 1, waterRisePerTurn: 10 };
    let s = createMatch(sd);
    const start = s.sim.waterY;
    while (s.turns.round === 1) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.waterY).toBeLessThan(start);
    const before = s.sim.waterY;
    const turn = s.turns.turn;
    while (s.turns.turn === turn) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.waterY).toBe(before - 10);
  });

  it("places 4 teams of 4 on distinct spawns standing on ground, across seeds", () => {
    const full: MatchConfig = { ...cfg, mapWidth: 2048, mapHeight: 1024, teamSizes: [4, 4, 4, 4] };
    for (const seed of [1, 2, 3, 77, 4242, 99999]) {
      const s = createMatch({ ...full, seed });
      expect(s.sim.critters).toHaveLength(16);
      const xs = new Set(s.sim.critters.map((c) => c.x >> 16));
      expect(xs.size).toBe(16);
      for (const c of s.sim.critters) {
        const x = c.x >> 16;
        const y = c.y >> 16;
        expect(y).toBeLessThan(s.sim.waterY);
        expect(isSolid(s.sim.terrain, x, y + 1)).toBe(true); // ground under the feet
        expect(isSolid(s.sim.terrain, x, y - 10)).toBe(false); // clear above
      }
    }
  });

  it("throws instead of stacking critters when the map has no room for them", () => {
    const tiny: MatchConfig = { ...cfg, mapWidth: 160, mapHeight: 128, teamSizes: [4, 4, 4, 4] };
    expect(() => createMatch(tiny)).toThrow(RangeError);
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
    expect(isCmd({ k: "teleport" })).toBe(false);
    expect(
      isCmd({ k: "fire", weaponId: "acorn-mortar", angleDeg: 90, power: 100, fuseSeconds: 3 }),
    ).toBe(true);
    expect(isCmd({ k: "fire", weaponId: "laser", angleDeg: 90, power: 100 })).toBe(false);
    expect(isCmd({ k: "fire", weaponId: "acorn-mortar", angleDeg: 400, power: 100 })).toBe(false);
    expect(isCmd({ k: "fire", weaponId: "acorn-mortar", angleDeg: 90, power: 1.5 })).toBe(false);
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

describe("arsenal weapons through the match", () => {
  const cfg2: MatchConfig = { ...cfg };
  it("validates a strike target and carries it into the sim", () => {
    const ok = {
      k: "fire",
      weaponId: "beehive-strike",
      angleDeg: 0,
      power: 0,
      target: { x: 100, y: 200 },
    };
    expect(isCmd(ok)).toBe(true);
    expect(isCmd({ ...ok, target: { x: 1.5, y: 2 } })).toBe(false);
    expect(isCmd({ ...ok, target: { x: -1, y: 2 } })).toBe(false);
    expect(isCmd({ ...ok, target: { x: 1, y: 2, z: 3 } })).toBe(false);
    let s = run(createMatch(cfg2), 30);
    s = stepMatch(cfg2, s, [ok as Cmd]).state;
    expect(s.turns.phase).toBe("retreat");
    expect(s.sim.strikes).toHaveLength(1);
  });

  it("the shotgun keeps control after one blast, and unspent shots do not carry over", () => {
    let s = run(createMatch(cfg2), 30);
    const shot = { k: "fire", weaponId: "pepper-shotgun", angleDeg: 90, power: 50 } as Cmd;
    s = stepMatch(cfg2, s, [shot]).state;
    expect(s.turns.phase).toBe("control");
    expect(s.sim.burst).not.toBeNull();
    s = stepMatch(cfg2, s, [{ k: "skip" }]).state;
    s = run(s, 200);
    expect(s.sim.burst).toBeNull();
  });
});
