// Test players for match tests: a TestClient plus the MatchMirror it keeps
// from server messages, and a helper that takes two of them into a match.

import {
  MatchMirror,
  YAW_STEPS,
  hashMatch,
  type MatchState,
  type SimEvent,
} from "@burrow-brawl/shared";
import type { MatchSettings, ServerMessage } from "@burrow-brawl/shared/src/net";
import type { MatchRunner } from "../match/runner";
import type { Harness, TestClient } from "./harness";

/** A client plus the mirror it keeps from server messages. */
export class Player {
  mirror: MatchMirror | null = null;
  desyncs = 0;
  ended: Extract<ServerMessage, { t: "match.end" }> | null = null;
  /** Every sim event this player's mirror produced, in order. */
  readonly events: SimEvent[] = [];
  constructor(public c: TestClient) {}

  private advance(tick: number): void {
    for (const s of this.mirror!.advance(tick)) this.events.push(...s.events);
  }

  apply(m: ServerMessage): void {
    switch (m.t) {
      case "match.start":
        this.mirror = new MatchMirror(m.config, m.snapshot);
        break;
      case "tick":
        if (this.mirror) {
          this.mirror.onTick(m);
          if (m.h === undefined) break;
          this.advance(m.upTo); // reach the hashed tick to check it
          if (this.mirror.desyncedAt !== null) {
            this.desyncs++;
            this.c.send({ t: "desync", tick: m.upTo, h: hashMatch(this.mirror.state) });
          }
        }
        break;
      case "snapshot":
        this.mirror?.onSnapshot(m.snapshot);
        break;
      case "match.end":
        this.ended = m;
        break;
    }
  }

  /** Process messages until one matches `pred`. */
  async until(pred: (m: ServerMessage) => boolean): Promise<void> {
    for (const m of await this.c.drainUntil(pred)) this.apply(m);
  }

  /**
   * Process everything up to the confirmation of `tick`, then simulate to it.
   * The server confirms every 3 ticks, so `tick` must be a multiple of 3.
   */
  async syncTo(tick: number): Promise<void> {
    await this.until((m) => m.t === "tick" && m.upTo >= tick);
    this.advance(tick);
  }
}

/** Alba hosts, Bram joins, both ready, match starts. Alba's team plays first. */
export async function startTwoPlayerMatch(
  h: Harness,
  settings: Partial<MatchSettings> = {},
): Promise<{ a: Player; b: Player; runner: MatchRunner; code: string }> {
  const ca = await h.player("Alba");
  ca.send({ t: "room.create" });
  const { code } = await ca.room();
  const cb = await h.player("Bram");
  cb.send({ t: "room.join", code });
  await cb.next("room.joined");
  await ca.room((s) => s.members.length === 2);
  // Short turns so tests can cycle them.
  await ca.request({
    t: "lobby.setSettings",
    patch: { turnSeconds: 15, crittersPerTeam: 2, mapSeed: 99, ...settings },
  });
  ca.send({ t: "lobby.ready", ready: true });
  cb.send({ t: "lobby.ready", ready: true });
  await ca.room((s) => s.members.every((m) => m.ready));
  ca.send({ t: "lobby.start" });
  const a = new Player(ca);
  const b = new Player(cb);
  await a.until((m) => m.t === "match.start");
  await b.until((m) => m.t === "match.start");
  const runner = h.server.registry.get(code)!.match!;
  return { a, b, runner, code };
}

/** Heading (0..YAW_STEPS-1) from the active critter toward the middle of the map. */
export function yawTowardCenter(st: MatchState): number {
  const me = st.sim.critters.find((c) => c.id === st.turns.activeCritter)!;
  const dx = st.sim.terrain.sizeX / 2 - me.pos.x / 65536;
  const dz = st.sim.terrain.sizeZ / 2 - me.pos.z / 65536;
  const steps = Math.round((Math.atan2(dz, dx) / (2 * Math.PI)) * YAW_STEPS);
  return ((steps % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
}
