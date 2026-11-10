// Pepper Shotgun, Root Punch, Jelly Mine and Beehive Strike. Everything here is integer or Q16.16
// maths (trig from the sine table, never Math.sin/cos) so every machine computes the same match.
import type { Fixed } from "../fixed";
import { cosDeg, fmul, idiv, isqrt, sinDeg, toFixed } from "../fixed";
import { carveCircle, isSolid } from "../terrain";
import type { Terrain } from "../terrain";
import { loadWeapons } from "../weapons/load";
import type { WeaponData } from "../weapons/types";
import { CRITTER_HEIGHT, MAX_HEALTH, TERMINAL_VELOCITY, TICK_RATE } from "./constants";
import { critterHit, explode, num, perTick } from "./projectiles";
import type {
  Burst,
  Critter,
  FireCommand,
  Mine,
  Projectile,
  Rng,
  SimEvent,
  SimState,
  Strike,
} from "./types";

const cell = (f: Fixed): number => f >> 16;

export type ArsenalWeaponId = "pepper-shotgun" | "root-punch" | "jelly-mine" | "beehive-strike";

export function isArsenalWeapon(id: string): id is ArsenalWeaponId {
  return (
    id === "pepper-shotgun" || id === "root-punch" || id === "jelly-mine" || id === "beehive-strike"
  );
}

const MUZZLE_HEIGHT = 12;
/** Shots start this far from the body centre so they never hit the shooter. */
const SHOT_START = 6;
/** A punch launches at this fraction of the weapon's knockback: critters fall slowly, so the raw value would be lethal. */
const PUNCH_LAUNCH_NUM = 1;
const PUNCH_LAUNCH_DEN = 2;
const CLAMP_V = TERMINAL_VELOCITY * 2;

const clampV = (v: Fixed): Fixed => Math.max(-CLAMP_V, Math.min(CLAMP_V, v)) | 0;

/** Apply damage and a velocity kick to one critter, emitting damage/died. */
function hurt(c: Critter, amount: number, kvx: Fixed, kvy: Fixed, events: SimEvent[]): Critter {
  let hp = c.hp;
  let status = c.status;
  if (amount > 0) {
    const dealt = Math.min(hp, amount);
    hp -= dealt;
    events.push({ type: "damage", critterId: c.id, amount: dealt, cause: "explosion" });
    if (hp <= 0) {
      status = "dead";
      events.push({ type: "died", critterId: c.id, cause: "explosion" });
    }
  }
  return {
    ...c,
    hp: Math.max(0, Math.min(MAX_HEALTH, hp)),
    status,
    vx: clampV(c.vx + kvx),
    vy: clampV(c.vy + kvy),
    grounded: false,
    peakY: cell(c.y),
  };
}

// ------------------------------------------------------------ pepper shotgun

/** One hitscan blast. The turn ends (a `fired` event) only after the last shot of the burst. */
function shoot(
  terrain: Terrain,
  critters: readonly Critter[],
  shooter: Critter,
  cmd: FireCommand,
  w: WeaponData,
  rng: Rng | undefined,
  events: SimEvent[],
): { critters: Critter[]; hit: number | null } {
  const spread = Math.trunc(num(w.params, "spreadDegrees", 0));
  const jitter = rng && spread > 0 ? rng.nextInt(2 * spread + 1) - spread : 0;
  const angle = Math.trunc(cmd.angleDeg) + jitter;
  const cos = cosDeg(angle);
  const sin = sinDeg(angle);
  const range = Math.trunc(num(w.params, "range", 500));
  const sx = cell(shooter.x);
  const sy = cell(shooter.y) - MUZZLE_HEIGHT;
  let px: Fixed = (toFixed(sx) + SHOT_START * cos) | 0;
  let py: Fixed = (toFixed(sy) - SHOT_START * sin) | 0;
  let hitId: number | null = null;
  let carved = 0;
  let ex = cell(px);
  let ey = cell(py);
  for (let i = SHOT_START; i < range; i++) {
    px = (px + cos) | 0;
    py = (py - sin) | 0;
    ex = cell(px);
    ey = cell(py);
    const target = critters.find((c) => c.id !== shooter.id && critterHit(c, ex, ey));
    if (target) {
      hitId = target.id;
      break;
    }
    if (isSolid(terrain, ex, ey)) {
      carved = Math.max(1, Math.trunc(num(w.params, "tunnelWidth", 4)));
      carveCircle(terrain, ex, ey, carved);
      break;
    }
  }
  events.push({
    type: "shot",
    critterId: shooter.id,
    x0: sx,
    y0: sy,
    x1: ex,
    y1: ey,
    hitCritterId: hitId,
    carved,
  });
  if (hitId === null) return { critters: [...critters], hit: null };
  const kb = perTick(w.knockback);
  return {
    critters: critters.map((c) =>
      c.id === hitId ? hurt(c, w.damage, fmul(kb, cos), -fmul(kb, sin) | 0, events) : c,
    ),
    hit: hitId,
  };
}

// ------------------------------------------------------------ root punch

function punch(
  critters: readonly Critter[],
  puncher: Critter,
  facing: -1 | 1,
  w: WeaponData,
  events: SimEvent[],
): Critter[] {
  const range = Math.trunc(num(w.params, "range", 40));
  const enemiesOnly = w.params.targetsEnemiesOnly !== false;
  const px = cell(puncher.x);
  const py = cell(puncher.y);
  let best: Critter | null = null;
  let bestDx = Infinity;
  for (const c of critters) {
    if (c.id === puncher.id || c.status !== "alive") continue;
    if (enemiesOnly && c.team === puncher.team) continue;
    const dx = (cell(c.x) - px) * facing;
    if (dx < 0 || dx > range || Math.abs(cell(c.y) - py) >= CRITTER_HEIGHT) continue;
    if (dx < bestDx) {
      best = c;
      bestDx = dx;
    }
  }
  events.push({ type: "punched", critterId: puncher.id, targetId: best ? best.id : null });
  if (!best) return [...critters];
  const launch = Math.trunc(num(w.params, "launchAngleDegrees", 70));
  const speed = idiv(perTick(w.knockback) * PUNCH_LAUNCH_NUM, PUNCH_LAUNCH_DEN) | 0;
  const kvx = (facing * fmul(speed, cosDeg(launch))) | 0;
  const kvy = -fmul(speed, sinDeg(launch)) | 0;
  const id = best.id;
  return critters.map((c) => (c.id === id ? hurt(c, w.damage, kvx, kvy, events) : c));
}

// ------------------------------------------------------------ fire dispatch

export interface ArsenalResult {
  readonly critters: Critter[];
  readonly mines: readonly Mine[];
  readonly strikes: readonly Strike[];
  readonly burst: Burst | null;
  readonly nextId: number;
}

/**
 * Apply one fire command for a non-projectile weapon. Returns null if the command does nothing
 * (no `fired` event, so control continues). Emits `fired` when the weapon's use is complete.
 */
export function useArsenalWeapon(
  s: {
    terrain: Terrain;
    critters: readonly Critter[];
    mines: readonly Mine[];
    strikes: readonly Strike[];
    burst: Burst | null;
    nextId: number;
  },
  shooter: Critter,
  cmd: FireCommand,
  rng: Rng | undefined,
  events: SimEvent[],
): ArsenalResult | null {
  if (!isArsenalWeapon(cmd.weaponId)) return null;
  const w = loadWeapons()[cmd.weaponId];
  const fired = (): void => {
    events.push({ type: "fired", critterId: shooter.id, projectileId: 0, weaponId: cmd.weaponId });
  };
  const facing: -1 | 1 = cosDeg(cmd.angleDeg) < 0 ? -1 : 1;
  const face = (list: Critter[]): Critter[] =>
    list.map((c) => (c.id === shooter.id ? { ...c, facing } : c));

  switch (cmd.weaponId) {
    case "pepper-shotgun": {
      const total = Math.max(1, Math.trunc(num(w.params, "shotsPerTurn", 2)));
      const owed = s.burst?.critterId === shooter.id ? s.burst.left : total;
      const r = shoot(s.terrain, s.critters, shooter, cmd, w, rng, events);
      const left = owed - 1;
      if (left <= 0) fired();
      return {
        ...s,
        critters: face(r.critters),
        burst: left > 0 ? { critterId: shooter.id, left } : null,
      };
    }
    case "root-punch": {
      const critters = face(punch(s.critters, shooter, facing, w, events));
      fired();
      return { ...s, critters, burst: null };
    }
    case "jelly-mine": {
      const maxActive = Math.max(1, Math.trunc(num(w.params, "maxActiveMines", 6)));
      const mine: Mine = {
        id: s.nextId,
        ownerId: shooter.id,
        x: cell(shooter.x),
        y: cell(shooter.y),
        age: 0,
      };
      const kept =
        s.mines.length >= maxActive ? s.mines.slice(s.mines.length - maxActive + 1) : s.mines;
      events.push({
        type: "minePlaced",
        critterId: shooter.id,
        mineId: mine.id,
        x: mine.x,
        y: mine.y,
      });
      fired();
      return { ...s, critters: [...s.critters], mines: [...kept, mine], nextId: s.nextId + 1 };
    }
    case "beehive-strike": {
      const t = cmd.target;
      if (!t) return null; // needs a click point
      const x = Math.max(0, Math.min(s.terrain.width - 1, Math.trunc(t.x)));
      const y = Math.max(0, Math.min(s.terrain.height - 1, Math.trunc(t.y)));
      const strike: Strike = { id: s.nextId, ownerId: shooter.id, x, y, dropped: 0, nextIn: 0 };
      events.push({ type: "strikeCalled", critterId: shooter.id, x, y });
      fired();
      return {
        ...s,
        critters: [...s.critters],
        strikes: [...s.strikes, strike],
        nextId: s.nextId + 1,
      };
    }
  }
}

// ------------------------------------------------------------ per-tick systems

/** Release due bombs. Returns the remaining strikes and the new bomb projectiles. */
export function stepStrikes(
  strikes: readonly Strike[],
  firstBombId: number,
): { strikes: Strike[]; bombs: Projectile[]; nextId: number } {
  const w = loadWeapons()["beehive-strike"];
  const count = Math.max(1, Math.trunc(num(w.params, "bombCount", 5)));
  const spread = Math.trunc(num(w.params, "spreadWidth", 300));
  const height = Math.trunc(num(w.params, "dropHeight", 600));
  const interval = Math.max(1, Math.round(num(w.params, "dropIntervalSeconds", 0.35) * TICK_RATE));
  const bombs: Projectile[] = [];
  const next: Strike[] = [];
  let id = firstBombId;
  for (const st of strikes) {
    let { dropped, nextIn } = st;
    if (nextIn <= 0) {
      // Bombs fall evenly spaced across the spread, left to right.
      const offset =
        count === 1 ? 0 : Math.trunc(((2 * dropped - (count - 1)) * spread) / (2 * (count - 1)));
      bombs.push({
        id: id++,
        ownerId: st.ownerId,
        weaponId: "beehive-strike",
        x: toFixed(st.x + offset),
        y: toFixed(st.y - height),
        vx: 0,
        vy: 0,
        age: 0,
        fuseTicks: -1,
        bounces: 0,
        resting: false,
      });
      dropped++;
      nextIn = interval;
    }
    nextIn--;
    if (dropped < count) next.push({ ...st, dropped, nextIn });
  }
  return { strikes: next, bombs, nextId: id };
}

/** Age mines, drop them if the ground vanished, and detonate armed mines a critter has walked near. */
export function stepMines(
  state: Pick<SimState, "terrain" | "waterY">,
  mines: readonly Mine[],
  critters: readonly Critter[],
  events: SimEvent[],
): { mines: Mine[]; critters: Critter[] } {
  const w = loadWeapons()["jelly-mine"];
  const armTicks = Math.round(num(w.params, "armSeconds", 2) * TICK_RATE);
  const trigger = Math.trunc(num(w.params, "triggerRadius", 40));
  let cs = [...critters];
  const next: Mine[] = [];
  for (const m of mines) {
    let { y } = m;
    if (!isSolid(state.terrain, m.x, y + 1)) y++; // ground carved away: fall one cell per tick
    if (y > state.waterY) continue; // sank in the soda
    const age = m.age + 1;
    if (age === armTicks) events.push({ type: "mineArmed", mineId: m.id });
    if (age >= armTicks) {
      const near = cs.some((c) => {
        if (c.status !== "alive") return false;
        const dx = cell(c.x) - m.x;
        const dy = cell(c.y) - (CRITTER_HEIGHT >> 1) - y;
        return isqrt(dx * dx + dy * dy) <= trigger;
      });
      if (near) {
        cs = explode(state.terrain, cs, { id: m.id, weaponId: "jelly-mine" }, m.x, y - 2, events);
        continue;
      }
    }
    next.push({ ...m, y, age });
  }
  return { mines: next, critters: cs };
}
