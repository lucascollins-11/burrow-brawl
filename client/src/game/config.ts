import type { MatchConfig } from "@burrow-brawl/shared";
import { TICKS_PER_SECOND } from "@burrow-brawl/shared";

/**
 * Hot-seat match settings, overridable from the URL for quick tests:
 * ?teams=2..4&size=1..4&seed=123&turn=45
 */
export function matchConfigFromUrl(search = window.location.search): MatchConfig {
  const q = new URLSearchParams(search);
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const v = Number(q.get(key));
    return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  };
  const teams = int("teams", 2, 2, 8);
  const size = int("size", 2, 1, 4);
  const seed =
    q.has("seed") && Number.isInteger(Number(q.get("seed")))
      ? Number(q.get("seed")) >>> 0
      : crypto.getRandomValues(new Uint32Array(1))[0]!;
  return {
    seed,
    teamSizes: Array.from({ length: teams }, () => size),
    turnTicks: int("turn", 45, 5, 300) * TICKS_PER_SECOND,
    retreatTicks: 3 * TICKS_PER_SECOND,
    settleCapTicks: 10 * TICKS_PER_SECOND,
    startHealth: 100,
    windMax: 60,
    mapWidth: 2048,
    mapHeight: 1024,
    suddenDeathRound: 8,
    waterRisePerTurn: 8,
  };
}
