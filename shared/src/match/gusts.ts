// Storm gusts: in a storm the wind does not hold still through a turn. On top of the turn's
// rolled wind a gust swells and dies away, a new one every GUST_PERIOD ticks, with lulls between.
// Pure integer function of (match seed, tick), so the server, every client mirror and a replay
// all feel the same gust on the same tick without touching the match rng.

import { YAW_STEPS } from "../sim3d/api";
import { cosYaw, mulDiv, sinYaw } from "../sim3d/vec3";
import { FIXED_ONE } from "../fixed";
import { mix32 } from "../terrain3d/spawns";

/** Ticks from one gust peak to the next (1.5 s at 60 ticks a second). */
export const GUST_PERIOD = 90;
/** The sim clamps wind to this per axis. */
export const WIND_LIMIT = 100;
/** Salt so gusts never line up with other hashes of the same seed. */
const GUST_SALT = 0x6a57;

/** True when this match's weather is a storm (the only weather the sim cares about). */
export function isStorm(sky: { weather: string } | undefined): boolean {
  return sky?.weather === "storm";
}

/** A storm's turn wind range: half again the lobby's setting, capped at the sim's limit. */
export function stormWindMax(windMax: number): number {
  return Math.min(WIND_LIMIT, windMax + (windMax >> 1));
}

/** How hard a storm gust can blow for a lobby wind setting. Wind off means no gusts either. */
export function gustAmplitude(windMax: number): number {
  return windMax <= 0 ? 0 : Math.min(WIND_LIMIT >> 1, Math.max(12, windMax >> 1));
}

/** The gust at peak `k`: one in four is a lull, the rest blow 1/3..1 of `amp` in any direction. */
function peak(seed: number, k: number, amp: number): { x: number; z: number } {
  const h = mix32(seed >>> 0, GUST_SALT, k);
  if (h % 4 === 0) return { x: 0, z: 0 };
  const heading = (h >>> 2) % YAW_STEPS;
  const low = Math.trunc(amp / 3);
  const strength = low + ((h >>> 12) % (amp - low + 1));
  return {
    x: mulDiv(cosYaw(heading), strength, FIXED_ONE),
    z: mulDiv(sinYaw(heading), strength, FIXED_ONE),
  };
}

/** The gust on `tick`: eased straight lines between consecutive peaks. */
export function gustAt(seed: number, tick: number, amp: number): { x: number; z: number } {
  if (amp <= 0 || tick < 0) return { x: 0, z: 0 };
  const k = Math.floor(tick / GUST_PERIOD);
  const f = tick - k * GUST_PERIOD;
  const a = peak(seed, k, amp);
  const b = peak(seed, k + 1, amp);
  return {
    x: a.x + Math.trunc(((b.x - a.x) * f) / GUST_PERIOD),
    z: a.z + Math.trunc(((b.z - a.z) * f) / GUST_PERIOD),
  };
}

/** Turn wind plus gust, clamped to what the sim accepts. */
export function windWithGust(
  windX: number,
  windZ: number,
  gust: { x: number; z: number },
): { windX: number; windZ: number } {
  const clamp = (v: number): number => Math.max(-WIND_LIMIT, Math.min(WIND_LIMIT, v));
  return { windX: clamp(windX + gust.x), windZ: clamp(windZ + gust.z) };
}
