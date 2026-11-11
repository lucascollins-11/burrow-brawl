import { afterEach, describe, expect, it } from "vitest";
import { createMatch, hashMatch } from "@burrow-brawl/shared";
import { PROTOCOL_VERSION } from "@burrow-brawl/shared/src/net";
import type { MatchRunner } from "./match/runner";
import { startHarness, type Harness } from "./testing/harness";
import { Player, startTwoPlayerMatch } from "./testing/players";

let h: Harness;
afterEach(async () => {
  await h?.close();
});

async function startMatch(): Promise<{ a: Player; b: Player; runner: MatchRunner; code: string }> {
  return startTwoPlayerMatch(h);
}

describe("authoritative match", () => {
  it("starts with the same snapshot for everyone", async () => {
    h = await startHarness();
    const { a, b, runner } = await startMatch();
    expect(a.mirror!.tick).toBe(0);
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
    expect(hashMatch(b.mirror!.state)).toBe(hashMatch(runner.matchState));
    expect(a.mirror!.config.seed).toBe(99);
    expect(a.mirror!.state.sim.critters).toHaveLength(4);
  });

  it("relays the active player's commands and keeps every mirror in sync", async () => {
    h = await startHarness();
    const { a, b, runner } = await startMatch();
    runner.advance(42); // let critters land
    await a.syncTo(42);
    await b.syncTo(42);

    // Team 0 (Alba) has the first turn; Bram may not send.
    expect(await b.c.request({ t: "input", turn: 1, cmds: [{ k: "jump" }] })).toMatchObject({
      code: "not_your_turn",
    });
    expect(await a.c.request({ t: "input", turn: 7, cmds: [{ k: "jump" }] })).toMatchObject({
      code: "input_rejected",
    });
    expect(await a.c.request({ t: "input", turn: 1, cmds: [{ k: "move", yaw: 0 }] })).toMatchObject(
      {
        t: "ok",
      },
    );
    runner.advance(30);
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "jump" }] });
    runner.advance(48);
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "move", yaw: -1 }] });
    runner.advance(60); // through tick 180, a hash tick

    await a.syncTo(180);
    await b.syncTo(180);
    const want = hashMatch(runner.matchState);
    expect(hashMatch(a.mirror!.state)).toBe(want);
    expect(hashMatch(b.mirror!.state)).toBe(want);
    expect(a.desyncs + b.desyncs).toBe(0);
    // The commands actually moved the critter.
    const id = runner.matchState.turns.activeCritter;
    const fresh = createMatch(runner.config).sim.critters.find((c) => c.id === id)!;
    expect(b.mirror!.state.sim.critters.find((c) => c.id === id)!.pos).not.toEqual(fresh.pos);
  });

  it("skip passes the turn and clients see the same turn state", async () => {
    h = await startHarness();
    const { a, b, runner } = await startMatch();
    runner.advance(40);
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "skip" }] });
    runner.advance(50);
    await a.syncTo(90);
    await b.syncTo(90);
    expect(runner.matchState.turns).toMatchObject({ turn: 2, activeTeam: 1 });
    expect(b.mirror!.state.turns).toEqual(runner.matchState.turns);
    expect(await a.c.request({ t: "input", turn: 2, cmds: [{ k: "jump" }] })).toMatchObject({
      code: "not_your_turn",
    });
    expect(await b.c.request({ t: "input", turn: 2, cmds: [{ k: "jump" }] })).toMatchObject({
      t: "ok",
    });
  });

  it("repairs a desynced client with a snapshot", async () => {
    h = await startHarness();
    const { a, runner } = await startMatch();
    runner.advance(10);
    await a.syncTo(9);
    // Corrupt the local mirror: a command the server never stamped.
    a.mirror!.onInputs(10, [{ k: "jump" }]);
    runner.advance(20); // hash at 30
    await a.until((m) => m.t === "tick" && m.upTo === 30);
    expect(a.desyncs).toBe(1);
    await a.until((m) => m.t === "snapshot");
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
    runner.advance(30);
    await a.syncTo(60);
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
  });

  it("a reconnecting player gets a snapshot and continues in sync", async () => {
    h = await startHarness();
    const { a, b, runner, code } = await startMatch();
    runner.advance(45);
    b.c.ws.terminate();
    await a.c.room((s) => s.members.some((m) => !m.connected));
    runner.advance(30);

    const c2 = await h.client();
    c2.send({
      t: "hello",
      token: b.c.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: b.c.resumeToken,
    });
    const b2 = new Player(c2);
    await b2.until((m) => m.t === "room.joined" && m.room.code === code);
    await b2.until((m) => m.t === "match.start");
    expect(b2.mirror!.tick).toBe(75);
    runner.advance(45);
    await b2.syncTo(120);
    expect(hashMatch(b2.mirror!.state)).toBe(hashMatch(runner.matchState));
  });

  it("skips the turn of a disconnected player", async () => {
    h = await startHarness();
    const { a, b, runner } = await startMatch();
    runner.advance(40);
    b.c.ws.terminate();
    await a.c.room((s) => s.members.some((m) => !m.connected));
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "skip" }] });
    // Bram's turn starts, the server skips it, and it comes back to Alba.
    runner.advance(80);
    expect(runner.matchState.turns).toMatchObject({ activeTeam: 0 });
    expect(runner.matchState.turns.turn).toBeGreaterThanOrEqual(3);
    await a.syncTo(120);
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
  });

  it("lets the timer run when the active player drops mid-turn, and a reconnect resumes", async () => {
    h = await startHarness();
    const { a, runner, code } = await startMatch();
    runner.advance(42);
    a.c.ws.terminate();
    await a.c.closed;
    for (let i = 0; i < 50 && h.server.registry.get(code)!.connectedCount() !== 1; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    runner.advance(120);
    expect(runner.matchState.turns).toMatchObject({ turn: 1, phase: "control", activeTeam: 0 });

    const c2 = await h.client();
    c2.send({
      t: "hello",
      token: a.c.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: a.c.resumeToken,
    });
    const a2 = new Player(c2);
    await a2.until((m) => m.t === "match.start");
    expect(await c2.request({ t: "input", turn: 1, cmds: [{ k: "skip" }] })).toMatchObject({
      t: "ok",
    });
    runner.advance(3);
    expect(runner.matchState.turns).not.toMatchObject({ turn: 1, phase: "control" });
  });

  it("stops the match when everyone leaves", async () => {
    h = await startHarness();
    const { a, b, runner, code } = await startMatch();
    let stopped = 0;
    const stop = runner.stop.bind(runner);
    runner.stop = () => {
      stopped++;
      stop();
    };
    a.c.send({ t: "room.leave" });
    await a.c.next("room.left");
    b.c.send({ t: "room.leave" });
    await b.c.next("room.left");
    expect(h.server.registry.get(code)).toBeUndefined();
    expect(stopped).toBeGreaterThan(0);
  });

  it("ends the match, shows results, and the host's match.rematch returns to the lobby", async () => {
    h = await startHarness();
    const { a, b, runner } = await startMatch();
    runner.advance(40);
    // Knock out team 1 directly on the server (weapons arrive with S4).
    const st = runner.matchState;
    (runner as unknown as { state: typeof st }).state = {
      ...st,
      sim: {
        ...st.sim,
        critters: st.sim.critters.map((c) =>
          c.team === 1 ? { ...c, status: "drowned" as const } : c,
        ),
      },
    };
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "skip" }] });
    runner.advance(5);
    await a.until((m) => m.t === "match.end");
    expect(a.ended).toMatchObject({ winnerTeamId: "t1" });
    const results = await a.c.room((s) => s.phase === "results");
    expect(results.members.every((m) => !m.ready)).toBe(true);
    // Only the host takes the room back to the lobby.
    expect(await b.c.request({ t: "match.rematch" })).toMatchObject({ code: "not_host" });
    expect(await a.c.request({ t: "lobby.ready", ready: true })).toMatchObject({
      code: "match_in_progress",
    });
    expect(await a.c.request({ t: "match.rematch" })).toMatchObject({ t: "ok" });
    const room = await a.c.room((s) => s.phase === "lobby");
    expect(room.teams.filter((t) => t.controllerId !== null)).toHaveLength(2);
    expect(await a.c.request({ t: "match.rematch" })).toMatchObject({ code: "not_allowed" });
  });

  it("a player reconnecting on the results screen lands in results, then follows the rematch", async () => {
    h = await startHarness();
    const { a, b, runner, code } = await startMatch();
    runner.advance(40);
    const st = runner.matchState;
    (runner as unknown as { state: typeof st }).state = {
      ...st,
      sim: {
        ...st.sim,
        critters: st.sim.critters.map((c) =>
          c.team === 1 ? { ...c, status: "drowned" as const } : c,
        ),
      },
    };
    await a.c.request({ t: "input", turn: 1, cmds: [{ k: "skip" }] });
    runner.advance(5);
    await a.c.room((s) => s.phase === "results");

    b.c.ws.terminate();
    await a.c.room((s) => s.members.some((m) => !m.connected));
    const c2 = await h.client();
    c2.send({
      t: "hello",
      token: b.c.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: b.c.resumeToken,
    });
    const joined = await c2.next("room.joined");
    expect(joined.room).toMatchObject({ code, phase: "results" });
    expect(joined.room.members.every((m) => m.connected)).toBe(true);
    expect(c2.peek().some((m) => m.t === "match.start")).toBe(false);

    expect(await a.c.request({ t: "match.rematch" })).toMatchObject({ t: "ok" });
    expect((await c2.room((s) => s.phase === "lobby")).code).toBe(code);
  });
});
