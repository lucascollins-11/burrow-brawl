// Kinematic critter controller: footprint columns times body height, step-up/step-down while
// walking, ballistic flight with substeps of at most one voxel per axis. No rigid bodies.

import type { Fixed } from "../fixed";
import { FIXED_ONE, idiv } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import type { Critter, CritterInput, SimEvent } from "./api";
import { CRITTER_HEIGHT, CRITTER_RADIUS_HALF, MAX_STEP_DOWN, MAX_STEP_UP } from "./api";
import {
  BACKFLIP_VXZ,
  BACKFLIP_VY,
  GRAVITY,
  JUMP_VXZ,
  JUMP_VY,
  LENGTH_DEN,
  LENGTH_NUM,
  MAX_HEALTH,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./constants";
import { loadWeapons } from "../weapons/load";
import { applyEdit, isSolid } from "./terrainOps";
import { mulQ, yawDir } from "./vec3";

export const cell = (f: Fixed): number => f >> 16;

/**
 * Column offsets (dx, dz) from the feet voxel: every voxel whose centre lies within the body
 * radius of the feet voxel's centre. Radius 1.5 gives the full 3x3.
 */
export const FOOTPRINT: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  const r = CRITTER_RADIUS_HALF >> 1;
  const r2x4 = CRITTER_RADIUS_HALF * CRITTER_RADIUS_HALF; // (2 * radius)^2
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) if (4 * (dx * dx + dz * dz) <= r2x4) out.push([dx, dz]);
  return out;
})();

/** True if a critter with feet at voxel (x, y, z) would overlap solid terrain. */
export function bodyBlocked(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of FOOTPRINT)
    for (let dy = 0; dy < CRITTER_HEIGHT; dy++) if (isSolid(t, x + dx, y + dy, z + dz)) return true;
  return false;
}

/** True if any footprint column has solid ground directly under the feet. */
export function hasGround(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of FOOTPRINT) if (isSolid(t, x + dx, y - 1, z + dz)) return true;
  return false;
}

export function createCritter(
  id: number,
  team: number,
  x: number,
  y: number,
  z: number,
  hp: number = MAX_HEALTH,
): Critter {
  return {
    id,
    team,
    // Feet centred in the voxel horizontally, on its floor vertically.
    pos: {
      x: x * FIXED_ONE + (FIXED_ONE >> 1),
      y: y * FIXED_ONE,
      z: z * FIXED_ONE + (FIXED_ONE >> 1),
    },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp,
    status: "alive",
    grounded: false,
    peakY: y,
  };
}

/** Try one walking move to (nx, nz): climb up to MAX_STEP_UP, then snap down to MAX_STEP_DOWN. */
function tryWalk(
  t: VoxelTerrain,
  nx: Fixed,
  y: Fixed,
  nz: Fixed,
): { y: Fixed; grounded: boolean } | null {
  const cx = cell(nx);
  const cz = cell(nz);
  let cy = cell(y);
  let up = 0;
  while (up <= MAX_STEP_UP && bodyBlocked(t, cx, cy + up, cz)) up++;
  if (up > MAX_STEP_UP) return null;
  cy += up;
  const clear = cy;
  let down = 0;
  while (down < MAX_STEP_DOWN && !hasGround(t, cx, cy, cz)) {
    cy--;
    down++;
  }
  if (hasGround(t, cx, cy, cz)) return { y: cy * FIXED_ONE, grounded: true };
  // Walked off a ledge: fall from the stepped-up height, never from inside terrain.
  return { y: up === 0 ? y : clear * FIXED_ONE, grounded: false };
}

/** The critter without its drill state (the Drill Hat stopped). */
export function stopDrill(c: Critter): Critter {
  if (c.drillTicks === undefined && c.drillDir === undefined) return c;
  const { drillTicks: _t, drillDir: _d, ...rest } = c;
  void _t;
  void _d;
  return rest;
}

/** The Drill Hat carves a sphere this often (ticks), ahead of the body. */
export const DRILL_CARVE_EVERY = 4;

/**
 * One tick of Drill Hat tunnelling: carve ahead every DRILL_CARVE_EVERY ticks, then move along
 * the drill heading. Stops when the time is up, the way is blocked (bedrock, or ground the
 * carve did not clear), or the critter was knocked (it has a velocity again). Input is ignored.
 */
function drillStep(t: VoxelTerrain, c: Critter): Critter {
  const w = loadWeapons()["drill-hat"];
  const tunnel = typeof w.params.tunnelRadius === "number" ? w.params.tunnelRadius : 14;
  const radius = Math.max(3, Math.floor((tunnel * LENGTH_NUM) / LENGTH_DEN));
  const dir = c.drillDir!;
  if (c.vel.x !== 0 || c.vel.y !== 0 || c.vel.z !== 0) return stopDrill(c);
  const ticks = c.drillTicks!;
  const down = dir.x === 0 && dir.z === 0;
  const { x, y, z } = c.pos;
  // Going down stops at bedrock, or at the map's soda row so the dig can't drown its own critter.
  const floor = Math.max(t.bedrockY, t.seaY);
  if (ticks % DRILL_CARVE_EVERY === 0) {
    // Centre: 8 ticks of travel ahead; at mid-body height sideways, at the feet going down.
    const cx = cell(x + dir.x * 8);
    const cz = cell(z + dir.z * 8);
    const cy = down ? cell(y + dir.y * 8) : cell(y) + 3;
    // Never carve below the floor, so the critter is left standing on it.
    applyEdit(t, { op: "carve", x: cx, y: Math.max(floor + radius, cy), z: cz, r: radius });
  }
  const nx = x + dir.x;
  const ny = y + dir.y;
  const nz = z + dir.z;
  const blocked = bodyBlocked(t, cell(nx), cell(ny), cell(nz)) || (down && cell(ny) < floor);
  if (blocked || ticks <= 1) return { ...stopDrill(c), peakY: cell(y) };
  return {
    ...c,
    pos: { x: nx, y: ny, z: nz },
    drillTicks: ticks - 1,
    peakY: cell(ny),
  };
}

/** Advance one critter by one tick. Pure: returns a new record and pushes events. */
export function stepCritter(
  t: VoxelTerrain,
  c: Critter,
  input: CritterInput | undefined,
  events: SimEvent[],
): Critter {
  if (c.status !== "alive") return stopDrill(c);
  if (c.drillTicks !== undefined) return drillStep(t, c);
  let { x, y, z } = c.pos;
  let vx = c.vel.x;
  let vy = c.vel.y;
  let vz = c.vel.z;
  let { yaw, grounded, peakY } = c;
  const moveYaw = input?.moveYaw ?? -1;
  const moving = moveYaw >= 0;
  if (moving) yaw = moveYaw;

  if (grounded) {
    if (input?.jump || input?.backflip) {
      const back = !input.jump && !!input.backflip;
      const dir = yawDir(yaw);
      const h = back ? -BACKFLIP_VXZ : JUMP_VXZ;
      vx = mulQ(dir.x, h);
      vz = mulQ(dir.z, h);
      vy = back ? BACKFLIP_VY : JUMP_VY;
      grounded = false;
      peakY = cell(y);
      events.push({ type: "jumped", critterId: c.id, backflip: back });
    } else {
      vx = 0;
      vy = 0;
      vz = 0;
      if (moving) {
        const dir = yawDir(yaw);
        const nx = x + mulQ(dir.x, WALK_SPEED);
        const nz = z + mulQ(dir.z, WALK_SPEED);
        // Full move first, then slide along whichever axis is free.
        const tries: readonly (readonly [Fixed, Fixed])[] = [
          [nx, nz],
          [nx, z],
          [x, nz],
        ];
        for (const [tx, tz] of tries) {
          const r = tryWalk(t, tx, y, tz);
          if (!r) continue;
          x = tx;
          z = tz;
          y = r.y;
          if (!r.grounded) {
            grounded = false;
            peakY = cell(y);
          }
          break;
        }
      } else if (!hasGround(t, cell(x), cell(y), cell(z))) {
        grounded = false; // ground carved away
        peakY = cell(y);
      }
    }
  }

  if (!grounded) {
    vy = Math.max(vy - GRAVITY, -TERMINAL_VELOCITY);
    const maxV = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
    const n = Math.max(1, (maxV + FIXED_ONE - 1) >> 16);
    let sx = idiv(vx, n);
    const sy = idiv(vy, n);
    let sz = idiv(vz, n);
    for (let i = 0; i < n; i++) {
      if (sx !== 0) {
        if (bodyBlocked(t, cell(x + sx), cell(y), cell(z))) vx = sx = 0;
        else x += sx;
      }
      if (sz !== 0) {
        if (bodyBlocked(t, cell(x), cell(y), cell(z + sz))) vz = sz = 0;
        else z += sz;
      }
      const ny = y + sy;
      if (sy > 0 && bodyBlocked(t, cell(x), cell(ny), cell(z))) {
        vy = 0; // bumped head
        break;
      }
      if (sy < 0 && cell(ny) !== cell(y) && bodyBlocked(t, cell(x), cell(ny), cell(z))) {
        y = cell(y) * FIXED_ONE; // land on the floor of the current voxel
        grounded = true;
        vx = 0;
        vy = 0;
        vz = 0;
        events.push({ type: "landed", critterId: c.id, fallDistance: peakY - cell(y) });
        break;
      }
      y = ny;
      if (cell(y) > peakY) peakY = cell(y);
    }
  }

  return { ...c, pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, yaw, grounded, peakY };
}
