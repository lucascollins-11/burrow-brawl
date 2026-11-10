// The browser client's net API against a real in-process server.
import { afterEach, describe, expect, it } from "vitest";
import { hashMatch } from "@burrow-brawl/shared";
import { GameClient, NetError } from "@burrow-brawl/client/src/net";
import { startHarness, type Harness } from "./testing/harness";

let h: Harness;
const clients: GameClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await h?.close();
});

async function connect(nickname: string): Promise<GameClient> {
  const c = await GameClient.connect({ nickname, serverUrl: `ws://127.0.0.1:${h.port}` });
  clients.push(c);
  return c;
}

const until = (pred: () => boolean, ms = 2000) =>
  new Promise<void>((res, rej) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (pred()) {
        clearInterval(t);
        res();
      } else if (Date.now() - start > ms) {
        clearInterval(t);
        rej(new Error("condition not met"));
      }
    }, 5);
  });

describe("GameClient end to end", () => {
  it("creates and joins a room, runs the lobby, and plays a synced 3-turn match with a shot", async () => {
    h = await startHarness();
    const alba = await connect("Alba");
    const bram = await connect("Bram");

    const room = await alba.createRoom();
    expect(alba.isHost).toBe(true);
    const joined = await bram.joinRoom(room.code.toLowerCase());
    expect(joined.members).toHaveLength(2);
    await expect(bram.startMatch()).rejects.toMatchObject({ code: "not_host" });
    await expect(bram.setTeam("t1")).rejects.toBeInstanceOf(NetError);

    await alba.setSettings({ crittersPerTeam: 1, mapSeed: 5 });
    await alba.setReady(true);
    await bram.setReady(true);
    let started = 0;
    bram.on("matchStart", () => started++);
    await alba.startMatch();
    await until(() => started === 1 && alba.match.mirror !== null);

    const runner = h.server.registry.get(room.code)!.match!;
    const players = [alba, bram];
    const events: string[] = [];
    const serverHas = () =>
      (runner as unknown as { pending: Map<number, unknown> }).pending.size > 0;
    /** Wait for both clients to get the newest watermark, then fast-forward them to it. */
    const sync = async () => {
      const t = runner.tick;
      await until(() => players.every((p) => p.match.mirror!.confirmed >= t));
      for (const p of players) {
        const steps = p.match.update();
        if (p === alba) for (const s of steps) for (const e of s.events) events.push(e.type);
        expect(p.match.mirror!.tick).toBe(t);
      }
    };
    /** Run the server until turn `n` starts (whole watermark batches only). */
    const toTurn = async (n: number) => {
      for (let i = 0; i < 2000 && runner.turn < n; i++) runner.advance(3);
      expect(runner.turn).toBe(n);
      await sync();
    };
    const send = async (p: GameClient, cmds: Parameters<GameClient["sendCmds"]>[0]) => {
      p.sendCmds(cmds);
      await until(serverHas);
      runner.advance(3);
    };

    runner.advance(30); // critters land
    await sync();

    // Turn 1, Alba: aim toward the middle and fire an acorn mortar.
    expect(alba.match.state!.turns).toMatchObject({ turn: 1, activeTeam: 0 });
    const me = alba.match.state!.sim.critters.find(
      (c) => c.id === alba.match.state!.turns.activeCritter,
    )!;
    const angleDeg = me.x >> 16 < runner.config.mapWidth / 2 ? 55 : 125;
    await send(alba, [{ k: "fire", weaponId: "acorn-mortar", angleDeg, power: 35 }]);
    await toTurn(2);
    expect(events).toContain("fired");
    expect(events).toContain("explosion");

    // Turn 2, Bram: hop in place, then end the turn.
    expect(bram.match.state!.turns).toMatchObject({ turn: 2, activeTeam: 1 });
    await send(bram, [{ k: "jump" }]);
    runner.advance(30);
    await sync();
    expect(bram.match.state!.turns).toMatchObject({ turn: 2, phase: "control" });
    await send(bram, [{ k: "skip" }]);
    await toTurn(3);

    // Turn 3, Alba skips.
    expect(alba.match.state!.turns).toMatchObject({ turn: 3, activeTeam: 0 });
    await send(alba, [{ k: "skip" }]);
    await toTurn(4);

    // Finish on a hash tick so the clients also checked the server's hash.
    while (runner.tick % 30 !== 0) runner.advance(3);
    await sync();
    const want = hashMatch(runner.matchState);
    expect(hashMatch(alba.match.state!)).toBe(want);
    expect(hashMatch(bram.match.state!)).toBe(want);
    for (const p of players) expect(p.match.mirror!.desyncedAt).toBeNull();
  });

  it("surfaces room errors as NetError codes", async () => {
    h = await startHarness();
    const c = await connect("Pip");
    await expect(c.joinRoom("ZZZZZ")).rejects.toMatchObject({ code: "room_not_found" });
  });
});
