import { HAT_STYLES, type CritterView, type ViewState } from "./viewState";

export interface TeamSummary {
  readonly index: number;
  readonly name: string;
  readonly alive: number;
  readonly total: number;
  readonly hp: number;
  readonly maxHp: number;
  /** 0..1 */
  readonly fraction: number;
  readonly out: boolean;
  readonly active: boolean;
}

/** One compact bar per team. A team's bar is the sum of its critters' health. */
export function summarizeTeams(v: ViewState): TeamSummary[] {
  return v.teams.map((t) => {
    const cs = v.critters.filter((c) => c.team === t.index);
    const alive = cs.filter((c) => c.alive).length;
    const hp = cs.reduce((a, c) => a + (c.alive ? c.hp : 0), 0);
    const maxHp = cs.reduce((a, c) => a + c.maxHp, 0);
    return {
      index: t.index,
      name: t.name,
      alive,
      total: cs.length,
      hp,
      maxHp,
      fraction: maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0,
      out: alive === 0,
      active: v.activeTeam === t.index && v.phase !== "over",
    };
  });
}

/**
 * Turn order strip: teams still in the game, starting with the active team and cycling after it.
 * If nobody is active (settling), it starts from team 0.
 */
export function turnOrder(v: ViewState): number[] {
  const alive = summarizeTeams(v)
    .filter((t) => !t.out)
    .map((t) => t.index);
  if (alive.length === 0) return [];
  const from = v.activeTeam === null ? alive[0]! : v.activeTeam;
  const start = alive.findIndex((i) => i >= from);
  const s = start === -1 ? 0 : start;
  return [...alive.slice(s), ...alive.slice(0, s)];
}

export interface Streamer {
  /** Heading the wind blows toward, degrees (0 = +z, 90 = +x). */
  readonly headingDeg: number;
  /** 0..1 */
  readonly strength: number;
}

/** Wind as one direction and strength: the paper streamers point and flutter by these. */
export function windStreamer(w: { x: number; z: number }): Streamer {
  const mag = Math.hypot(w.x, w.z);
  return {
    headingDeg: mag === 0 ? 0 : ((Math.atan2(w.x, w.z) * 180) / Math.PI + 360) % 360,
    strength: Math.min(1, mag / 100),
  };
}

export const compass = (headingDeg: number): string =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8
  ]!;

export function turnBanner(v: ViewState): string {
  if (v.phase === "over")
    return v.winnerTeam === null ? "Draw!" : `${v.teams[v.winnerTeam]?.name ?? "A team"} wins!`;
  const c: CritterView | undefined = v.critters.find((x) => x.id === v.activeCritterId);
  const team = v.teams[v.activeTeam ?? -1]?.name ?? "";
  if (v.phase === "retreat") return `${team}: run for cover!`;
  if (v.phase === "settling") return "Waiting for things to settle…";
  return c ? `${team}'s turn: ${c.name}` : `${team}'s turn`;
}

export const hatFor = (teamIndex: number) => HAT_STYLES[teamIndex % HAT_STYLES.length]!;
