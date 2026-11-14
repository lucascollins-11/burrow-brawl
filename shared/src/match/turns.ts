// Turn flow for every match (server, client mirrors and hot-seat run this same code). Turn state
// is plain JSON data so it is hashed and snapshotted with the rest of the match. Deterministic:
// the only randomness is the injected match rng.

import { FIXED_ONE } from "../fixed";
import type { Rng, SimEvent, SimState } from "../sim3d/api";
import { YAW_STEPS } from "../sim3d/api";
import { isSettled } from "../sim3d/world";
import { cosYaw, mulDiv, sinYaw } from "../sim3d/vec3";

export type TurnPhase =
  /** The active player controls their critter until the timer ends. */
  | "control"
  /** After firing: the critter can still move for retreatTicks. */
  | "retreat"
  /** No control; waiting for the world to stop moving before the next turn. */
  | "settling"
  /** Match finished; see winnerTeam. */
  | "over";

export type TurnEndReason = "timeout" | "skip" | "fired" | "damaged" | "absent";

export interface TurnState {
  /** 1-based turn number; increments on every new turn. */
  turn: number;
  /** 1-based round; increments when rotation wraps back to the first team. */
  round: number;
  phase: TurnPhase;
  /**
   * Sim team index of the team whose turn it is (or was, while settling).
   * Use TurnController.activeTeam() to ask who may send inputs right now.
   */
  activeTeam: number | null;
  /** Critter id of that team's current critter. */
  activeCritter: number | null;
  /** Tick at which the current phase ends (control/retreat timer, settle cap). */
  phaseEndTick: number;
  /** Per team: rotation cursor into that team's critters (sorted by id). */
  nextCritter: number[];
  /** Set when phase is "over": winning team index, or null for a draw. */
  winnerTeam: number | null;
  /**
   * Wind for the current turn as a horizontal vector, each component in
   * [-windMax, windMax]. Rolled from the match rng when each turn starts as a
   * heading and a strength; the match copies it into the sim every tick.
   */
  windX: number;
  windZ: number;
  /**
   * Storms only: the gust blowing on top of windX/windZ this tick (see gusts.ts). The sim feels
   * the sum. Absent outside storms, so calm matches hash exactly as before.
   */
  gustX?: number;
  gustZ?: number;
}

export interface TurnRules {
  teams: number;
  turnTicks: number;
  retreatTicks: number;
  /** Max ticks to wait for the world to settle before forcing the next turn. */
  settleCapTicks: number;
  /** Wind range; 0 disables wind. */
  windMax: number;
}

export interface TurnController {
  /** Initial state with turn 1 already started at `tick`. */
  init(sim: SimState, rules: TurnRules, tick: number, rng: Rng): TurnState;
  activeTeam(ts: TurnState): number | null;
  /** Ticks left in the current phase (0 if none). */
  timer(ts: TurnState, tick: number): number;
  /** End control: "fired" starts retreat, anything else goes to settling. No-op outside control/retreat. */
  endTurn(ts: TurnState, rules: TurnRules, reason: TurnEndReason, tick: number): TurnState;
  /**
   * Called once per tick after stepWorld with that tick's events. Handles
   * timer expiry, damage to the active critter, settle detection, starting
   * the next turn, and the win check. Must not mutate `ts`.
   */
  update(
    ts: TurnState,
    rules: TurnRules,
    sim: SimState,
    events: readonly SimEvent[],
    tick: number,
    rng: Rng,
  ): TurnState;
}

function aliveTeams(sim: SimState, teams: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < teams; t++) {
    if (sim.critters.some((c) => c.team === t && c.status === "alive")) out.push(t);
  }
  return out;
}

/** Roll this turn's wind: a heading and a strength, stored as integer components. */
function rollWind(rules: TurnRules, rng: Rng): { windX: number; windZ: number } {
  if (rules.windMax <= 0) return { windX: 0, windZ: 0 };
  const heading = rng.nextInt(YAW_STEPS);
  const strength = rng.nextInt(rules.windMax + 1);
  return {
    windX: mulDiv(cosYaw(heading), strength, FIXED_ONE),
    windZ: mulDiv(sinYaw(heading), strength, FIXED_ONE),
  };
}

/** Start the turn after the team in ts.activeTeam, or end the match. */
function startNext(
  ts: TurnState,
  rules: TurnRules,
  sim: SimState,
  tick: number,
  rng: Rng,
): TurnState {
  const alive = aliveTeams(sim, rules.teams);
  if (alive.length <= 1) {
    return {
      ...ts,
      phase: "over",
      activeTeam: null,
      activeCritter: null,
      phaseEndTick: tick,
      winnerTeam: alive[0] ?? null,
    };
  }
  // activeTeam stays set through settling, so it names the team that just played.
  const prev = ts.activeTeam ?? rules.teams - 1;
  let team = prev;
  for (let i = 1; i <= rules.teams; i++) {
    const cand = (prev + i) % rules.teams;
    if (alive.includes(cand)) {
      team = cand;
      break;
    }
  }
  const wrapped = ts.turn > 0 && team <= prev;
  const mine = sim.critters.filter((c) => c.team === team).sort((a, b) => a.id - b.id);
  const nextCritter = [...ts.nextCritter];
  let cursor = nextCritter[team] ?? 0;
  let critter = mine[0]!;
  for (let i = 0; i < mine.length; i++) {
    const c = mine[(cursor + i) % mine.length]!;
    if (c.status === "alive") {
      critter = c;
      cursor = (cursor + i) % mine.length;
      break;
    }
  }
  nextCritter[team] = (cursor + 1) % mine.length;
  return {
    turn: ts.turn + 1,
    round: ts.turn === 0 ? 1 : wrapped ? ts.round + 1 : ts.round,
    phase: "control",
    activeTeam: team,
    activeCritter: critter.id,
    phaseEndTick: tick + rules.turnTicks,
    nextCritter,
    winnerTeam: null,
    ...rollWind(rules, rng),
  };
}

export const basicTurns: TurnController = {
  init(sim, rules, tick, rng) {
    const blank: TurnState = {
      turn: 0,
      round: 0,
      phase: "settling",
      activeTeam: rules.teams - 1, // so the first turn goes to team 0
      activeCritter: null,
      phaseEndTick: tick,
      nextCritter: new Array<number>(rules.teams).fill(0),
      winnerTeam: null,
      windX: 0,
      windZ: 0,
    };
    return startNext(blank, rules, sim, tick, rng);
  },

  activeTeam(ts) {
    return ts.phase === "control" || ts.phase === "retreat" ? ts.activeTeam : null;
  },

  timer(ts, tick) {
    return ts.phase === "over" ? 0 : Math.max(0, ts.phaseEndTick - tick);
  },

  endTurn(ts, rules, reason, tick) {
    if (ts.phase !== "control" && ts.phase !== "retreat") return ts;
    if (reason === "fired" && ts.phase === "control") {
      return { ...ts, phase: "retreat", phaseEndTick: tick + rules.retreatTicks };
    }
    return { ...ts, phase: "settling", phaseEndTick: tick + rules.settleCapTicks };
  },

  update(ts, rules, sim, events, tick, rng) {
    switch (ts.phase) {
      case "over":
        return ts;
      case "control":
      case "retreat": {
        const hurt = events.some(
          (e) => (e.type === "damage" || e.type === "died") && e.critterId === ts.activeCritter,
        );
        if (hurt) return this.endTurn(ts, rules, "damaged", tick);
        if (tick >= ts.phaseEndTick) return this.endTurn(ts, rules, "timeout", tick);
        return ts;
      }
      case "settling":
        if (isSettled(sim) || tick >= ts.phaseEndTick) return startNext(ts, rules, sim, tick, rng);
        return ts;
    }
  },
};
