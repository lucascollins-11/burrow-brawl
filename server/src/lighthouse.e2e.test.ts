// Two players start a Lighthouse Village match (the biggest map: 512 voxels, about 3.3 MB of
// match.start for a view client). Guards the "Start Game just asks us to ready up again" report.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchRunner } from "./match/runner";
import { startHarness, type Harness, type TestClient } from "./testing/harness";
import { connectView } from "./testing/viewPlayer";

let h: Harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.close();
});

/** Alba hosts, Bram joins; both on a team and ready on Lighthouse Village. */
async function readyRoom(): Promise<{ a: TestClient; b: TestClient; code: string }> {
  const a = await connectView(h, "Alba");
  a.send({ t: "room.create" });
  const { code } = await a.room();
  const b = await connectView(h, "Bram");
  b.send({ t: "room.join", code });
  await b.next("room.joined");
  await a.room((s) => s.members.length === 2);
  await a.request({ t: "lobby.setSettings", patch: { mapTheme: "lighthouse-village", mapSize: 384 } });
  a.send({ t: "lobby.ready", ready: true });
  b.send({ t: "lobby.ready", ready: true });
  await a.room((s) => s.members.every((m) => m.ready));
  return { a, b, code };
}

describe("Lighthouse Village, two players", () => {
  it("starts for both players with the full island and its detail", async () => {
    h = await startHarness();
    const { a, b, code } = await readyRoom();
    a.send({ t: "lobby.start" });
    for (const c of [a, b]) {
      const start = (await c.next("match.start", 30_000)) as unknown as {
        config: { map: { theme: string; sizeX: number; sizeZ: number } };
        terrain: { decor?: unknown[] };
      };
      expect(start.config.map).toMatchObject({ theme: "lighthouse-village", sizeX: 512, sizeZ: 512 });
      expect((start.terrain.decor ?? []).length).toBeGreaterThan(1000);
    }
    expect(h.server.registry.get(code)!.phase).toBe("match");
    expect(h.server.registry.get(code)!.match).not.toBeNull();
  }, 60_000);

  it("puts everyone back in the lobby with a message when the match cannot start", async () => {
    h = await startHarness();
    const { a, b, code } = await readyRoom();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(MatchRunner.prototype, "start").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    a.send({ t: "lobby.start" });
    for (const c of [a, b]) {
      expect(await c.next("error", 30_000)).toMatchObject({ code: "internal" });
      expect((await c.room((s) => s.phase === "lobby")).phase).toBe("lobby");
    }
    expect(h.server.registry.get(code)!.match).toBeNull();
  }, 60_000);
});
