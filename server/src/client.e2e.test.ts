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
  it("creates and joins a room, runs the lobby, and plays a synced match", async () => {
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
    runner.advance(30);
    alba.sendCmds([{ k: "move", dir: 1 }]);
    await until(
      () => (bram.match.mirror as unknown as { pending: Map<number, unknown> }).pending.size > 0,
    );
    runner.advance(60); // to tick 90, a hash tick
    await until(() => alba.match.mirror!.confirmed >= 90 && bram.match.mirror!.confirmed >= 90);
    alba.match.mirror!.advance(90);
    bram.match.mirror!.advance(90);
    expect(hashMatch(alba.match.state!)).toBe(hashMatch(runner.matchState));
    expect(hashMatch(bram.match.state!)).toBe(hashMatch(runner.matchState));
    expect(alba.match.mirror!.desyncedAt).toBeNull();
  });

  it("surfaces room errors as NetError codes", async () => {
    h = await startHarness();
    const c = await connect("Pip");
    await expect(c.joinRoom("ZZZZZ")).rejects.toMatchObject({ code: "room_not_found" });
  });
});
