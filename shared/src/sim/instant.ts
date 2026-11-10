import type { Fixed } from "../fixed";
import { cosDeg, FIXED_ONE, fmul, sinDeg, toFixed } from "../fixed";
import type { Terrain } from "../terrain";
import type { WeaponId } from "../weapons/load";
import { loadWeapons } from "../weapons/load";
import { CRITTER_HALF_WIDTH, CRITTER_HEIGHT, TICK_RATE } from "./constants";
import { bodyBlocked } from "./body";
import type { Critter, FireCommand, SimEvent } from "./types";

/**
 * Instant weapons resolve on the tick they are fired and never create a projectile. They are the
 * sim's counterpart to projectile weapons: same FireCommand in, state change and events out.
 */
const INSTANT_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "skip-turn",
  "teleport-burrow",
  "spring-boots",
]);

export function isInstantWeapon(id: WeaponId): boolean {
  return INSTANT_WEAPONS.has(id);
}

const cell = (f: Fixed): number => f >> 16;

/** Units per second -> Q16.16 cells per tick, the same rounding projectiles use. */
function perTick(unitsPerSecond: number): Fixed {
  return Math.round((unitsPerSecond * FIXED_ONE) / TICK_RATE) | 0;
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/**
 * Apply an instant weapon for one critter. Returns the updated critter (or the same object when
 * nothing changed) and pushes events. Invalid use does nothing and ends no turn.
 */
export function applyInstantWeapon(
  t: Terrain,
  c: Critter,
  cmd: FireCommand,
  events: SimEvent[],
): Critter {
  const data = loadWeapons()[cmd.weaponId];
  switch (cmd.weaponId) {
    case "skip-turn": {
      events.push({ type: "turnEnded", critterId: c.id, weaponId: cmd.weaponId });
      return c;
    }

    case "teleport-burrow": {
      const target = cmd.target;
      if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return c;
      // The critter's whole body must fit at the destination, and inside the map.
      const inBounds =
        target.x >= CRITTER_HALF_WIDTH &&
        target.x <= t.width - 1 - CRITTER_HALF_WIDTH &&
        target.y >= CRITTER_HEIGHT &&
        target.y <= t.height - 1;
      if (!inBounds || bodyBlocked(t, target.x, target.y)) return c;

      events.push({ type: "teleported", critterId: c.id, x: target.x, y: target.y });
      if (data.endsTurn)
        events.push({ type: "turnEnded", critterId: c.id, weaponId: cmd.weaponId });
      // Pop out at rest; gravity takes over from the new spot on the next tick.
      return {
        ...c,
        x: toFixed(target.x),
        y: toFixed(target.y),
        vx: 0,
        vy: 0,
        grounded: false,
        peakY: target.y,
      };
    }

    case "spring-boots": {
      // Only from the ground, like a normal jump.
      if (!c.grounded) return c;
      const maxAngle = num(data.params, "maxAngleDegrees", 85);
      const angle = Math.max(90 - maxAngle, Math.min(90 + maxAngle, Math.trunc(cmd.angleDeg)));
      const speed = perTick(num(data.params, "jumpSpeed", 1000));
      const cos = cosDeg(angle);
      const sin = sinDeg(angle);
      events.push({ type: "springJumped", critterId: c.id });
      return {
        ...c,
        vx: fmul(speed, cos),
        vy: -fmul(speed, sin) | 0,
        facing: cos < 0 ? -1 : 1,
        grounded: false,
        peakY: cell(c.y),
      };
    }
  }
  return c;
}
