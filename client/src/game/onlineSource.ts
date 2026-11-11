import type { Cmd, MatchConfig, MatchMirror, MatchState, SimEvent } from "@burrow-brawl/shared";
import { TICKS_PER_SECOND } from "@burrow-brawl/shared";
import type { RoomState } from "@burrow-brawl/shared/src/net";
import type { NetMatch } from "../net";
import type { CmdInput } from "../game3d/controls";
import type { MatchSource } from "./source";

const STEP_MS = 1000 / TICKS_PER_SECOND;
const MAX_STEPS_PER_FRAME = 5;

/** What the online source needs from the game client. */
export interface OnlineClient {
  me: { id: string };
  room: RoomState | null;
}

/**
 * Online match: the sim state comes from the network mirror, which advances only up to the
 * server's confirmed tick. Local keyboard input is sampled at 60 Hz, kept only while one of
 * our teams has control, and sent to the server (which stamps and relays it back to everyone).
 */
export class OnlineSource implements MatchSource {
  readonly recentEvents: SimEvent[] = [];
  readonly localTeams: ReadonlySet<number>;
  private acc = 0;
  private lastTurn = -1;
  private lastMatchId: string | null;

  constructor(
    private readonly client: OnlineClient,
    private readonly net: NetMatch,
    private readonly input: CmdInput,
  ) {
    if (!net.mirror)
      throw new Error("OnlineSource: no match yet (create it from the matchStart event)");
    this.lastMatchId = net.matchId;
    this.localTeams = new Set(
      net.teamIds.flatMap((teamId, i) =>
        client.room?.teams.find((t) => t.id === teamId)?.controllerId === client.me.id ? [i] : [],
      ),
    );
  }

  get config(): MatchConfig {
    return this.mirror.config;
  }

  get state(): MatchState {
    return this.mirror.state;
  }

  /** The live mirror. A reconnect replaces it, so always read it through here. */
  private get mirror(): MatchMirror {
    const m = this.net.mirror;
    if (!m) throw new Error("OnlineSource: no match yet (create it from the matchStart event)");
    return m;
  }

  get matchId(): string | null {
    return this.lastMatchId;
  }

  advance(dtMs: number): SimEvent[] {
    const out: SimEvent[] = [];
    // Steps replayed in a burst (catching up after a stall or resync) skip effects and sounds.
    for (const step of this.net.update(dtMs)) {
      if (!step.fastForwarded) out.push(...step.events);
    }

    // Sample input on 60 Hz ticks so charge and aim speeds match hot-seat, whatever the frame rate.
    this.acc = Math.min(this.acc + dtMs, STEP_MS * MAX_STEPS_PER_FRAME);
    const ts = this.state.turns;
    const mine = ts.activeTeam !== null && this.localTeams.has(ts.activeTeam);
    const controlling = mine && (ts.phase === "control" || ts.phase === "retreat");
    this.input.enabled = controlling;
    if (ts.turn !== this.lastTurn) {
      this.lastTurn = ts.turn;
      this.input.newTurn();
    }
    const cmds: Cmd[] = [];
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      cmds.push(...this.input.read());
    }
    if (controlling && cmds.length > 0) this.net.sendCmds(cmds);

    this.recentEvents.push(...out);
    if (this.recentEvents.length > 8) this.recentEvents.splice(0, this.recentEvents.length - 8);
    return out;
  }
}
