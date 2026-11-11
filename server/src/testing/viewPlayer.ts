// A fake view client (docs/view-protocol.md) for server tests. It does what the Godot client
// does with the stream, and nothing more: decode the terrain, overwrite patched boxes, merge
// critter updates, replace projectiles. It never simulates, so if its world matches the server's
// the protocol carried everything a view client needs.

import { PROTOCOL_VERSION, decodeVoxels } from "@burrow-brawl/shared/src/net";
import type { ServerMessage, ViewServerMessage } from "@burrow-brawl/shared/src/net";
import type {
  ViewCritter,
  ViewProjectile,
  ViewState,
  ViewTerrain,
} from "@burrow-brawl/shared/src/net/view";
import type { SimEvent } from "@burrow-brawl/shared";
import type { MatchRunner } from "../match/runner";
import { viewCritter, viewProjectile } from "../match/view";
import type { Harness, TestClient } from "./harness";

type AnyMsg = ServerMessage | ViewServerMessage;

/** guest + connect + hello with view: true (and a resume token when reconnecting). */
export async function connectView(
  h: Harness,
  nickname: string,
  resume?: { token: string; id: string; resumeToken: string },
): Promise<TestClient> {
  const g = resume ?? (await h.guest(nickname));
  const c = await h.client();
  c.token = g.token;
  c.id = g.id;
  c.send({
    t: "hello",
    token: g.token,
    protocolVersion: PROTOCOL_VERSION,
    view: true,
    ...(resume ? { resumeToken: resume.resumeToken } : {}),
  });
  const w = await c.next("welcome");
  c.resumeToken = w.resumeToken;
  return c;
}

export class ViewPlayer {
  terrain: (Omit<ViewTerrain, "density"> & { density: Uint8Array }) | null = null;
  readonly critters = new Map<number, ViewCritter>();
  projectiles: ViewProjectile[] = [];
  state: ViewState | null = null;
  readonly events: SimEvent[] = [];
  /** Every message type and tick, in arrival order, for ordering checks. */
  readonly log: { t: string; tick: number }[] = [];
  starts = 0;
  patches = 0;
  /** Lockstep-only messages that reached this view client (must stay 0). */
  lockstepMessages = 0;
  ended: Extract<ServerMessage, { t: "match.end" }> | null = null;

  constructor(public c: TestClient) {}

  apply(raw: AnyMsg): void {
    const m = raw;
    switch (m.t) {
      case "match.start": {
        if (!("view" in m)) throw new Error("view client got a lockstep match.start");
        const t = m.terrain;
        this.terrain = { ...t, density: decodeVoxels(t.density, t.sizeX * t.sizeY * t.sizeZ) };
        this.critters.clear();
        for (const c of m.state.critters) this.critters.set(c.id, c);
        this.projectiles = m.state.projectiles;
        this.state = m.state;
        this.starts++;
        this.log.push({ t: m.t, tick: m.state.tick });
        break;
      }
      case "events":
        this.events.push(...m.events);
        this.log.push({ t: m.t, tick: m.tick });
        break;
      case "terrain.patch": {
        const t = this.terrain;
        if (!t) throw new Error("patch before match.start");
        const box = decodeVoxels(m.density, m.sx * m.sy * m.sz);
        let o = 0;
        for (let y = m.y0; y < m.y0 + m.sy; y++)
          for (let z = m.z0; z < m.z0 + m.sz; z++) {
            t.density.set(box.subarray(o, o + m.sx), (y * t.sizeZ + z) * t.sizeX + m.x0);
            o += m.sx;
          }
        this.patches++;
        this.log.push({ t: m.t, tick: m.tick });
        break;
      }
      case "state": {
        if (this.state && m.tick <= this.state.tick) throw new Error("state went backwards");
        for (const c of m.critters) this.critters.set(c.id, c);
        this.projectiles = m.projectiles;
        const { t: _t, ...rest } = m;
        void _t;
        this.state = rest;
        this.log.push({ t: m.t, tick: m.tick });
        break;
      }
      case "tick":
      case "snapshot":
        this.lockstepMessages++;
        break;
      case "match.end":
        this.ended = m;
        break;
    }
  }

  async until(pred: (m: AnyMsg) => boolean): Promise<void> {
    const msgs = (await this.c.drainUntil((m) => pred(m as AnyMsg))) as AnyMsg[];
    for (const m of msgs) this.apply(m);
  }

  /** Process the stream until a state at or past `tick`. */
  async syncTo(tick: number): Promise<void> {
    await this.until((m) => m.t === "state" && m.tick >= tick);
  }

  /** Differences between this client's world and the server's, empty when they agree. */
  diff(runner: MatchRunner): string[] {
    const s = runner.matchState;
    const out: string[] = [];
    const t = this.terrain;
    if (!t) return ["no terrain"];
    const want = s.sim.terrain.density;
    if (t.density.length !== want.length) out.push("terrain size");
    else {
      let bad = 0;
      for (let i = 0; i < want.length; i++) if (t.density[i] !== want[i]) bad++;
      if (bad) out.push(`${bad} voxels differ`);
    }
    if (this.state?.tick !== s.sim.tick) out.push(`tick ${this.state?.tick} vs ${s.sim.tick}`);
    for (const c of s.sim.critters) {
      const mine = this.critters.get(c.id);
      if (JSON.stringify(mine) !== JSON.stringify(viewCritter(c))) out.push(`critter ${c.id}`);
    }
    if (JSON.stringify(this.projectiles) !== JSON.stringify(s.sim.projectiles.map(viewProjectile)))
      out.push("projectiles");
    if (JSON.stringify(this.state?.turns) !== JSON.stringify(s.turns)) out.push("turns");
    return out;
  }
}
