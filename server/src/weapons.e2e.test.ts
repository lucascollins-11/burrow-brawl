// Online determinism, one case per weapon (table in testing/weaponCases.ts):
// Alba fires over real sockets, the turn plays out, and both clients' mirrors
// must hash exactly like the server and have seen identical sim events.

import { afterEach, describe, expect, it } from "vitest";
import { HASH_EVERY, hashMatch, type MatchState } from "@burrow-brawl/shared";
import { isDormant } from "@burrow-brawl/shared/src/sim3d/projectile";
import { topSolidY } from "@burrow-brawl/shared/src/terrain3d/impl";
import { startHarness, type Harness } from "./testing/harness";
import { startTwoPlayerMatch, yawTowardCenter } from "./testing/players";
import { WEAPON_CASES } from "./testing/weaponCases";

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** The surface voxel at the middle of the map, as a strike target. */
function surfaceCenter(st: MatchState): { x: number; y: number; z: number } {
  const t = st.sim.terrain;
  const x = t.sizeX >> 1;
  const z = t.sizeZ >> 1;
  return { x, y: Math.max(0, topSolidY(t, x, z)), z };
}

/** Ticks a turn may take after the shot before we call it stuck (fuse + flight + settle). */
const MAX_TURN_TICKS = 40 * 60;

describe("weapon determinism over the network", () => {
  it.each(WEAPON_CASES.map((c) => [`${c.weapon}${c.label ? ` (${c.label})` : ""}`, c] as const))(
    "%s",
    async (_name, c) => {
      h = await startHarness();
      const { a, b, runner } = await startTwoPlayerMatch(h);
      runner.advance(30); // spawns land
      await a.syncTo(30);
      await b.syncTo(30);
      expect(runner.matchState.turns).toMatchObject({ turn: 1, phase: "control", activeTeam: 0 });

      for (const cmds of c.before ?? []) {
        expect(await a.c.request({ t: "input", turn: 1, cmds })).toMatchObject({ t: "ok" });
        runner.advance(30);
      }

      // Aim toward the middle of the map, whichever side the shooter is on.
      const fire = {
        k: "fire" as const,
        weaponId: c.weapon,
        yaw: yawTowardCenter(runner.matchState),
        pitch: c.pitch,
        power: c.power,
        ...(c.fuseSeconds === undefined ? {} : { fuseSeconds: c.fuseSeconds }),
        ...(c.target === "center" ? { target: surfaceCenter(runner.matchState) } : {}),
      };
      expect(await a.c.request({ t: "input", turn: 1, cmds: [fire] })).toMatchObject({ t: "ok" });
      if (c.triggerAfter !== undefined) {
        runner.advance(c.triggerAfter);
        const pop = await a.c.request({ t: "input", turn: 1, cmds: [{ k: "trigger" }] });
        expect(pop).toMatchObject({ t: "ok" });
      }

      // Play the turn out: control ends, everything settles, turn 2 starts.
      for (let i = 0; i < MAX_TURN_TICKS / 3 && runner.turn === 1; i++) runner.advance(3);
      expect(runner.turn, "turn never passed after the shot").toBe(2);
      // Only placed charges (Jelly Mines) may outlive the turn.
      expect(runner.matchState.sim.projectiles.filter((p) => !isDormant(p))).toHaveLength(0);

      // Finish one hash past the turn change so the clients also checked the server's hash.
      runner.advance(HASH_EVERY - (runner.tick % HASH_EVERY) + HASH_EVERY);
      const end = runner.tick;
      await a.syncTo(end);
      await b.syncTo(end);

      const want = hashMatch(runner.matchState);
      expect(hashMatch(a.mirror!.state)).toBe(want);
      expect(hashMatch(b.mirror!.state)).toBe(want);
      expect(a.desyncs + b.desyncs).toBe(0);
      expect(b.events).toEqual(a.events);
      const seen = new Set(a.events.map((e) => e.type));
      for (const t of c.expect) expect(seen, `missing "${t}" event`).toContain(t);
    },
  );
});
