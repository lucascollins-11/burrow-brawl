import type { MatchConfig, MatchState, SimEvent } from "@burrow-brawl/shared";

/** Where the game scene gets its match from: the local hot-seat loop or the network mirror. */
export interface MatchSource {
  readonly config: MatchConfig;
  /** Current state to draw. May be replaced wholesale (a resync swaps the whole object). */
  readonly state: MatchState;
  readonly recentEvents: SimEvent[];
  /** Sim team indexes this player controls; null means hot-seat (everyone shares the keyboard). */
  readonly localTeams: ReadonlySet<number> | null;
  /** Advance by `dtMs` of real time; returns every sim event produced. */
  advance(dtMs: number): SimEvent[];
}
