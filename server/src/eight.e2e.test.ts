// Eight browser clients in one room: lobby, teams, ready, start, then eight turns of skips.
// Every client must stay in lockstep with the server's hash, with no desync reported.
import { afterEach, describe, expect, it } from "vitest";
import { hashMatch } from "@burrow-brawl/shared";
import { GameClient } from "@burrow-brawl/client/src/net";
import { startHarness, type Harness } from "./testing/harness";

let h: Harness | undefined;
const clients: GameClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await h?.close();
  h = undefined;
});

const until = (pred: () => boolean, ms = 4000) =>
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

describe("eight players end to end", () => {
  it("lets 8 clients join, start and play 8 turns in sync with the server", async () => {
    h = await startHarness();
    const url = `ws://127.0.0.1:${h.port}`;
    const connect = async (nickname: string) => {
      const c = await GameClient.connect({ nickname, serverUrl: url });
      clients.push(c);
      return c;
    };
    const names = ["Alba", "Bram", "Cleo", "Dov", "Esme", "Fynn", "Gus", "Hana"];
    const players: GameClient[] = [];
    for (const n of names) players.push(await connect(n));
    const host = players[0]!;

    const room = await host.createRoom();
    for (const p of players.slice(1)) await p.joinRoom(room.code);
    await until(() => host.room?.members.length === 8);

    // Grow the lobby to eight teams and give each player their own team.
    for (let i = 0; i < 6; i++) await host.addTeam();
    await until(() => host.room?.teams.length === 8);
    const teamIds = host.room!.teams.map((t) => t.id);
    for (let i = 0; i < 8; i++) await players[i]!.setTeam(teamIds[i]!);

    await host.setSettings({ crittersPerTeam: 2, mapSeed: 7 });
    for (const p of players) await p.setReady(true);
    let started = 0;
    for (const p of players) p.on("matchStart", () => started++);
    await host.startMatch();
    await until(() => started === 8 && players.every((p) => p.match.mirror !== null));

    const code = room.code;
    const runner = h.server.registry.get(code)!.match!;
    /** Sim team index for each player, from the match's team order. */
    const teamOf = players.map((p) => p.match.teamIds.indexOf(teamIds[players.indexOf(p)]!));
    expect(new Set(teamOf).size).toBe(8);

    /** Wait until every client has the newest watermark, then fast-forward each to it. */
    const sync = async () => {
      const t = runner.tick;
      await until(() => players.every((p) => p.match.mirror!.confirmed >= t));
      for (const p of players) {
        p.match.update();
        expect(p.match.mirror!.tick).toBe(t);
      }
    };
    /** Run the server until turn `n` is active (whole watermark batches), then sync. */
    const toTurn = async (n: number) => {
      for (let i = 0; i < 4000 && runner.turn < n; i++) runner.advance(3);
      expect(runner.turn).toBe(n);
      await sync();
    };

    runner.advance(60); // critters land on the spawn points
    await sync();

    for (let n = 1; n <= 8; n++) {
      await toTurn(n);
      const active = players[teamOf.indexOf(host.match.state!.turns.activeTeam!)]!;
      expect(active.match.state!.turns).toMatchObject({ turn: n });
      active.sendCmds([{ k: "skip" }]);
      await until(() => (runner as unknown as { pending: Map<number, unknown> }).pending.size > 0);
      runner.advance(3);
    }
    await toTurn(9);

    // Finish on a hash tick so every client also checked the server's hash.
    while (runner.tick % 30 !== 0) runner.advance(3);
    await sync();
    const want = hashMatch(runner.matchState);
    for (const p of players) {
      expect(hashMatch(p.match.state!)).toBe(want);
      expect(p.match.mirror!.desyncedAt).toBeNull();
    }
  }, 60_000);
});
