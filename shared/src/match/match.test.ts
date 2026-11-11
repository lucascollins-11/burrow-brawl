import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs } from "../determinism";
import { bodyBlocked } from "../sim3d/world";
import { isSolid } from "../terrain3d/impl";
import { fromBase64, toBase64 } from "./base64";
import {
  createMatch,
  hashMatch,
  isCmd,
  loadMatch,
  mapRecipeFor,
  mapSizeFor,
  saveMatch,
  stepMatch,
  type Cmd,
  type MatchConfig,
  type MatchState,
} from "./match";
import { MatchMirror } from "./mirror";
import { basicTurns } from "./turns";

const cfg: MatchConfig = {
  seed: 77,
  teamSizes: [2, 2],
  turnTicks: 300,
  retreatTicks: 60,
  settleCapTicks: 600,
  startHealth: 100,
  windMax: 50,
  map: mapRecipeFor(77, 2),
};

function run(
  state: MatchState,
  ticks: number,
  cmdsAt: (t: number) => Cmd[] = () => [],
): MatchState {
  for (let i = 0; i < ticks; i++) state = stepMatch(cfg, state, cmdsAt(state.sim.tick + 1)).state;
  return state;
}

const active = (s: MatchState) => s.sim.critters.find((c) => c.id === s.turns.activeCritter)!;
const mortar = (yaw: number, pitch = 45, power = 50): Cmd => ({
  k: "fire",
  weaponId: "acorn-mortar",
  yaw,
  pitch,
  power,
});

describe("base64", () => {
  it("round-trips all lengths", () => {
    for (let n = 0; n < 10; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
    expect(toBase64(new TextEncoder().encode("Squirmling"))).toBe("U3F1aXJtbGluZw==");
    expect(() => fromBase64("abc")).toThrow();
    expect(() => fromBase64("ab!d")).toThrow();
  });
});

describe("match model", () => {
  it("creates the same match from the same config", () => {
    const a = createMatch(cfg);
    const b = createMatch(cfg);
    expect(hashMatch(a)).toBe(hashMatch(b));
    const other = { ...cfg, seed: 78, map: mapRecipeFor(78, 2) };
    expect(hashMatch(createMatch(other))).not.toBe(hashMatch(a));
    expect(a.sim.critters.map((c) => c.team)).toEqual([0, 1, 0, 1]);
    expect(a.turns).toMatchObject({ turn: 1, round: 1, phase: "control", activeTeam: 0 });
  });

  it("is deterministic under scripted commands, with snapshot resume", () => {
    const small: MatchConfig = { ...cfg, turnTicks: 120 };
    const ticks = 500;
    const r = checkDeterminism<MatchState, Cmd>({
      seed: 1,
      ticks,
      init: () => createMatch(small),
      inputs: scriptedInputs(5, ticks, (rng): Cmd[] => {
        const roll = rng.nextInt(40);
        if (roll === 0) return [{ k: "jump" }];
        if (roll === 1) return [{ k: "backflip" }];
        if (roll === 2) return [{ k: "move", yaw: rng.nextInt(1025) - 1 }];
        if (roll === 3 && rng.chance(1, 8)) return [{ k: "skip" }];
        if (roll === 4) {
          const weaponId = rng.pick(["acorn-mortar", "fizz-grenade"] as const);
          return [
            {
              k: "fire",
              weaponId,
              yaw: rng.nextInt(1024),
              pitch: rng.nextRange(-20, 80),
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
      load: (snap) => loadMatch(small, snap as ReturnType<typeof saveMatch>),
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("restores carved terrain from a snapshot through JSON", () => {
    let s = run(createMatch(cfg), 5);
    s = stepMatch(cfg, s, [mortar(active(s).yaw, 30, 40)]).state;
    for (let i = 0; i < 1500 && s.sim.terrain.edits.length === 0; i++) {
      s = stepMatch(cfg, s, []).state;
    }
    expect(s.sim.terrain.edits.length).toBeGreaterThan(0);
    const snap = JSON.parse(JSON.stringify(saveMatch(s))) as ReturnType<typeof saveMatch>;
    const back = loadMatch(cfg, snap);
    expect(hashMatch(back)).toBe(hashMatch(s));
    expect(hashMatch(run(back, 60))).toBe(hashMatch(run(s, 60)));
  });

  it("held move applies only to the active critter and resets on a new turn", () => {
    let s = run(createMatch(cfg), 5);
    const id = s.turns.activeCritter!;
    const others = s.sim.critters.filter((c) => c.id !== id).map((c) => c.pos);
    const p0 = active(s).pos;
    // Try a few headings: a spawn can face a wall in one direction.
    let moved = false;
    for (const yaw of [0, 256, 512, 768]) {
      s = stepMatch(cfg, s, [{ k: "move", yaw }]).state;
      s = run(s, 20);
      expect(s.moveYaw).toBe(yaw);
      const p = active(s).pos;
      if (p.x !== p0.x || p.z !== p0.z) moved = true;
    }
    expect(moved).toBe(true);
    expect(s.sim.critters.filter((c) => c.id !== id).map((c) => c.pos)).toEqual(others);
    s = stepMatch(cfg, s, [{ k: "move", yaw: -1 }]).state;
    s = stepMatch(cfg, s, [{ k: "skip" }]).state;
    for (let i = 0; i < 600 && s.turns.turn === 1; i++) s = stepMatch(cfg, s, []).state;
    expect(s.turns).toMatchObject({ turn: 2, activeTeam: 1, phase: "control" });
    expect(basicTurns.activeTeam(s.turns)).toBe(1);
    expect(s.moveYaw).toBe(-1);
  });

  it("fire starts retreat, then the turn ends on the retreat timer", () => {
    let s = run(createMatch(cfg), 5);
    // Unsupported weapons do nothing; a real shot starts retreat.
    s = stepMatch(cfg, s, [
      { k: "fire", weaponId: "root-punch", yaw: 0, pitch: 45, power: 50 },
    ]).state;
    expect(s.turns.phase).toBe("control");
    s = stepMatch(cfg, s, [mortar(0, 80)]).state;
    expect(s.turns.phase).toBe("retreat");
    expect(s.sim.projectiles).toHaveLength(1);
    // No second shot during retreat.
    s = stepMatch(cfg, s, [mortar(0, 80)]).state;
    expect(s.sim.projectiles.length).toBeLessThanOrEqual(1);
    s = run(s, 61);
    expect(s.turns.phase).not.toBe("retreat");
  });

  it("holds the turn open for shots in flight and copies wind into the sim", () => {
    let s = run(createMatch(cfg), 5);
    expect([s.sim.windX, s.sim.windZ]).toEqual([s.turns.windX, s.turns.windZ]);
    expect(Math.abs(s.turns.windX)).toBeLessThanOrEqual(cfg.windMax);
    expect(Math.abs(s.turns.windZ)).toBeLessThanOrEqual(cfg.windMax);
    s = stepMatch(cfg, s, [mortar(0, 85, 100)]).state;
    expect(s.sim.projectiles).toHaveLength(1);
    const turn = s.turns.turn;
    let sawSettlingWithShot = false;
    for (let i = 0; i < 2500 && s.turns.turn === turn; i++) {
      s = stepMatch(cfg, s, []).state;
      if (s.turns.phase === "settling" && s.sim.projectiles.length > 0) sawSettlingWithShot = true;
    }
    expect(s.sim.projectiles).toHaveLength(0);
    expect(sawSettlingWithShot).toBe(true);
    expect([s.sim.windX, s.sim.windZ]).toEqual([s.turns.windX, s.turns.windZ]);
  });

  it("raises the soda every turn once sudden death starts", () => {
    const sd: MatchConfig = { ...cfg, suddenDeathRound: 1, seaRisePerTurn: 2 };
    let s = createMatch(sd);
    const start = s.sim.seaY;
    while (s.turns.round === 1) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.seaY).toBeGreaterThan(start);
    const before = s.sim.seaY;
    const turn = s.turns.turn;
    while (s.turns.turn === turn) s = stepMatch(sd, s, [{ k: "skip" }]).state;
    expect(s.sim.seaY).toBe(before + 2);
  });

  it("picks a map size by team count", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(mapSizeFor)).toEqual([
      192, 192, 256, 256, 320, 320, 384, 384,
    ]);
  });

  it("places 8 teams on distinct spawns standing on ground, across seeds", () => {
    for (const seed of [1, 2, 77]) {
      const full: MatchConfig = {
        ...cfg,
        seed,
        teamSizes: [2, 2, 2, 2, 2, 2, 2, 2],
        map: mapRecipeFor(seed, 8),
      };
      const s = createMatch(full);
      expect(s.sim.critters).toHaveLength(16);
      const spots = new Set(s.sim.critters.map((c) => `${c.pos.x >> 16},${c.pos.z >> 16}`));
      expect(spots.size).toBe(16);
      for (const c of s.sim.critters) {
        const x = c.pos.x >> 16;
        const y = c.pos.y >> 16;
        const z = c.pos.z >> 16;
        expect(y).toBeGreaterThanOrEqual(s.sim.seaY);
        expect(isSolid(s.sim.terrain, x, y - 1, z)).toBe(true);
        expect(bodyBlocked(s.sim.terrain, x, y, z)).toBe(false);
      }
    }
  });

  it("throws instead of stacking critters when the map has no room for them", () => {
    const crowd: MatchConfig = { ...cfg, teamSizes: Array.from({ length: 8 }, () => 200) };
    expect(() => createMatch(crowd)).toThrow(RangeError);
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
    let s = run(createMatch(cfg), 5);
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
    expect(isCmd({ k: "move", yaw: 1023 })).toBe(true);
    expect(isCmd({ k: "move", yaw: -1 })).toBe(true);
    expect(isCmd({ k: "move", yaw: 1024 })).toBe(false);
    expect(isCmd({ k: "move", yaw: 1.5 })).toBe(false);
    expect(isCmd({ k: "move", dir: 1 })).toBe(false);
    expect(isCmd({ k: "jump", extra: 1 })).toBe(false);
    expect(isCmd({ k: "teleport" })).toBe(false);
    const fire = { k: "fire", weaponId: "acorn-mortar", yaw: 90, pitch: 30, power: 100 };
    expect(isCmd({ ...fire, fuseSeconds: 3 })).toBe(true);
    expect(isCmd({ ...fire, target: { x: 1, y: 2, z: 3 } })).toBe(true);
    expect(isCmd({ ...fire, target: { x: 1, y: 2 } })).toBe(false);
    expect(isCmd({ ...fire, weaponId: "laser" })).toBe(false);
    expect(isCmd({ ...fire, yaw: 1024 })).toBe(false);
    expect(isCmd({ ...fire, pitch: 90 })).toBe(false);
    expect(isCmd({ ...fire, power: 1.5 })).toBe(false);
    expect(isCmd(null)).toBe(false);
  });
});

describe("MatchMirror", () => {
  it("follows relayed commands, stops at the confirmed tick, and checks hashes", () => {
    let server = createMatch(cfg);
    const mirror = new MatchMirror(cfg, saveMatch(server));
    const script = new Map<number, Cmd[]>([
      [40, [{ k: "move", yaw: 100 }]],
      [80, [{ k: "jump" }]],
      [120, [{ k: "move", yaw: -1 }]],
      [130, [mortar(300, 40, 60)]],
    ]);
    for (let t = 1; t <= 400; t++) {
      const cmds = script.get(t) ?? [];
      if (cmds.length) mirror.onInputs(t, cmds);
      server = stepMatch(cfg, server, cmds).state;
      if (t % 30 === 0) expect(mirror.onHash(t, hashMatch(server))).toBe(true);
      if (t === 100) {
        mirror.advance();
        expect(mirror.tick).toBe(90); // confirmed only up to the last hash
      }
    }
    mirror.onConfirmed(400);
    mirror.advance();
    expect(mirror.tick).toBe(400);
    expect(hashMatch(mirror.state)).toBe(hashMatch(server));
  });

  it("flags a desync and recovers from a snapshot", () => {
    let server = createMatch(cfg);
    const mirror = new MatchMirror(cfg, saveMatch(server));
    mirror.onInputs(10, [{ k: "jump" }]); // the server never applied this
    for (let t = 1; t <= 30; t++) server = stepMatch(cfg, server, []).state;
    mirror.onConfirmed(30);
    mirror.advance();
    expect(mirror.onHash(30, hashMatch(server))).toBe(false);
    expect(mirror.desyncedAt).toBe(30);
    mirror.onSnapshot(saveMatch(server));
    expect(mirror.desyncedAt).toBeNull();
    expect(hashMatch(mirror.state)).toBe(hashMatch(server));
  });
});
