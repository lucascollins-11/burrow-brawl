// View protocol over real sockets: a fake view client (testing/viewPlayer.ts) plays in a room
// with a lockstep client. The view client must end up with exactly the server's world while
// never simulating, and the lockstep client must stay in hash sync as before.

import { afterEach, describe, expect, it } from "vitest";
import { HASH_EVERY, hashMatch } from "@burrow-brawl/shared";
import type { MatchRunner } from "./match/runner";
import { startHarness, type Harness, type TestClient } from "./testing/harness";
import { Player, yawTowardCenter } from "./testing/players";
import { ViewPlayer, connectView } from "./testing/viewPlayer";

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** Vee (view client) hosts and plays first; Alba (lockstep) joins. */
async function mixedRoom(): Promise<{
  v: ViewPlayer;
  a: Player;
  runner: MatchRunner;
  code: string;
  vc: TestClient;
}> {
  const vc = await connectView(h, "Vee");
  vc.send({ t: "room.create" });
  const { code } = await vc.room();
  const ac = await h.player("Alba");
  ac.send({ t: "room.join", code });
  await ac.next("room.joined");
  await vc.room((s) => s.members.length === 2);
  await vc.request({
    t: "lobby.setSettings",
    patch: { turnSeconds: 15, crittersPerTeam: 2, mapSeed: 99 },
  });
  vc.send({ t: "lobby.ready", ready: true });
  ac.send({ t: "lobby.ready", ready: true });
  await vc.room((s) => s.members.every((m) => m.ready));
  vc.send({ t: "lobby.start" });
  const v = new ViewPlayer(vc);
  const a = new Player(ac);
  await v.until((m) => m.t === "match.start");
  await a.until((m) => m.t === "match.start");
  const runner = h.server.registry.get(code)!.match!;
  return { v, a, runner, code, vc };
}

/** Each batch is events, then patches, then the state for that tick, never anything after it. */
function expectBatchOrder(v: ViewPlayer): void {
  let stateTick = -1;
  let pendingTick: number | null = null;
  for (const e of v.log) {
    if (e.t === "match.start") {
      stateTick = e.tick;
      pendingTick = null;
      continue;
    }
    expect(e.tick).toBeGreaterThan(stateTick);
    if (e.t === "state") {
      if (pendingTick !== null) expect(e.tick).toBe(pendingTick);
      stateTick = e.tick;
      pendingTick = null;
    } else {
      if (pendingTick !== null) expect(e.tick).toBe(pendingTick);
      pendingTick = e.tick;
    }
  }
}

describe("view protocol", () => {
  it("a view client and a lockstep client share a match; the view client's world is the server's", async () => {
    h = await startHarness();
    const { v, a, runner } = await mixedRoom();

    // match.start is complete: decoded terrain and every critter, at tick 0.
    expect(v.state?.tick).toBe(0);
    expect(v.critters.size).toBe(4);
    expect(v.diff(runner)).toEqual([]);
    expect(a.mirror!.state.sim.critters).toHaveLength(4);

    runner.advance(30); // spawns land
    await v.syncTo(30);
    await a.syncTo(30);
    expect(v.diff(runner)).toEqual([]);
    expect(runner.matchState.turns).toMatchObject({ turn: 1, phase: "control", activeTeam: 0 });

    // The view client plays its turn: walk a bit, stop, fire at the middle.
    const yaw = yawTowardCenter(runner.matchState);
    expect(await v.c.request({ t: "input", turn: 1, cmds: [{ k: "move", yaw }] })).toMatchObject({
      t: "ok",
    });
    runner.advance(30);
    await v.c.request({ t: "input", turn: 1, cmds: [{ k: "move", yaw: -1 }] });
    runner.advance(3);
    const fire = {
      k: "fire" as const,
      weaponId: "acorn-mortar" as const,
      yaw: yawTowardCenter(runner.matchState),
      pitch: 55,
      power: 35,
    };
    expect(await v.c.request({ t: "input", turn: 1, cmds: [fire] })).toMatchObject({ t: "ok" });
    for (let i = 0; i < 800 && runner.turn === 1; i++) runner.advance(3);
    expect(runner.turn).toBe(2);
    runner.advance(HASH_EVERY - (runner.tick % HASH_EVERY) + HASH_EVERY);
    const end = runner.tick;
    await v.syncTo(end);
    await a.syncTo(end);

    // The view client saw the shot and the blast, got the carve as a patch, and agrees exactly.
    const types = new Set(v.events.map((e) => e.type));
    for (const t of ["fired", "explosion"]) expect(types).toContain(t);
    expect(v.patches).toBeGreaterThanOrEqual(1);
    expect(runner.matchState.sim.terrain.edits.length).toBe(v.patches);
    expect(v.diff(runner)).toEqual([]);
    expect(v.lockstepMessages).toBe(0);
    expectBatchOrder(v);

    // Both kinds saw the same sim events, and the lockstep client is still in hash sync.
    expect(v.events).toEqual(a.events);
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
    expect(a.desyncs).toBe(0);
  });

  it("state lists only critters that changed, and projectiles in full", async () => {
    h = await startHarness();
    const { v, runner } = await mixedRoom();
    runner.advance(90); // everyone has landed and stands still
    await v.syncTo(90);
    const quiet: number[] = [];
    runner.advance(9);
    await v.until((m) => {
      if (m.t === "state") quiet.push(m.critters.length, m.projectiles.length);
      return m.t === "state" && m.tick >= 99;
    });
    expect(quiet).toEqual([0, 0, 0, 0, 0, 0]);
    expect(v.diff(runner)).toEqual([]);
  });

  it("a view client that reconnects mid-match gets the whole world again and carries on", async () => {
    h = await startHarness();
    const { v, a, runner, vc } = await mixedRoom();
    runner.advance(30);
    await v.syncTo(30);
    const resume = { token: vc.token, id: vc.id, resumeToken: vc.resumeToken };

    // Vee drops mid-turn. The match runs on: Vee's timer runs, Alba waits.
    await vc.close();
    await a.c.room((s) => s.members.some((m) => m.id === resume.id && !m.connected));
    runner.advance(60);

    const vc2 = await connectView(h, "Vee", resume);
    const v2 = new ViewPlayer(vc2);
    await v2.until((m) => m.t === "match.start");
    expect(v2.starts).toBe(1);
    expect(v2.state?.tick).toBe(runner.tick);
    expect(v2.diff(runner)).toEqual([]);

    // Back in control for the rest of the turn: fire, and the stream stays exact.
    expect(runner.matchState.turns).toMatchObject({ turn: 1, activeTeam: 0 });
    const fire = {
      k: "fire" as const,
      weaponId: "fizz-grenade" as const,
      yaw: yawTowardCenter(runner.matchState),
      pitch: 50,
      power: 40,
      fuseSeconds: 2,
    };
    expect(await vc2.request({ t: "input", turn: 1, cmds: [fire] })).toMatchObject({ t: "ok" });
    for (let i = 0; i < 800 && runner.turn === 1; i++) runner.advance(3);
    runner.advance(HASH_EVERY - (runner.tick % HASH_EVERY));
    await v2.syncTo(runner.tick);
    await a.syncTo(runner.tick);
    expect(v2.events.some((e) => e.type === "explosion")).toBe(true);
    expect(v2.diff(runner)).toEqual([]);
    expect(v2.lockstepMessages).toBe(0);
    expectBatchOrder(v2);
    expect(hashMatch(a.mirror!.state)).toBe(hashMatch(runner.matchState));
  });

  it("a redundant room.join after a resumed hello does not resend match.start", async () => {
    h = await startHarness();
    const { v, runner, vc, code } = await mixedRoom();
    runner.advance(30);
    await v.syncTo(30);
    const resume = { token: vc.token, id: vc.id, resumeToken: vc.resumeToken };
    await vc.close();
    const vc2 = await connectView(h, "Vee", resume);
    const v2 = new ViewPlayer(vc2);
    await v2.until((m) => m.t === "match.start"); // the resume reseated us
    expect(await vc2.request({ t: "room.join", code })).toMatchObject({ t: "room.joined" });
    runner.advance(6);
    await v2.syncTo(runner.tick);
    expect(v2.starts).toBe(1);
    expect(v2.diff(runner)).toEqual([]);
  });

  it("room.sync after a failed resume says not_in_room, and room.join brings the seat back", async () => {
    h = await startHarness();
    const { v, runner, vc, code } = await mixedRoom();
    runner.advance(30);
    await v.syncTo(30);
    await vc.close();
    // A stale resume token: the hello is accepted but the seat is not reattached.
    const vc2 = await connectView(h, "Vee", { token: vc.token, id: vc.id, resumeToken: "stale" });
    expect(await vc2.request({ t: "room.sync" })).toMatchObject({
      t: "error",
      code: "not_in_room",
    });
    const v2 = new ViewPlayer(vc2);
    expect(await vc2.request({ t: "room.join", code })).toMatchObject({ t: "room.joined" });
    await v2.until((m) => m.t === "match.start");
    runner.advance(3);
    await v2.syncTo(runner.tick);
    expect(v2.starts).toBe(1);
    expect(v2.diff(runner)).toEqual([]);
  });

  it("ignores desync reports from a view client", async () => {
    h = await startHarness();
    const { v, runner } = await mixedRoom();
    expect(await v.c.request({ t: "desync", tick: 0, h: 1 })).toMatchObject({ t: "ok" });
    runner.advance(3);
    await v.syncTo(3);
    expect(v.lockstepMessages).toBe(0);
  });
});
