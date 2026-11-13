// Ground walkers and steered shots: the Wind-up Robot marches along its heading and turns back
// at walls, the RC Racer drives wherever its owner's walk input points, and the Kite Bomber
// flies level along its owner's steering with the wind behind it. Each moves one tick here in
// place of the ballistic flight in stepProjectiles; fuses and triggers work as for any shot.

import type { Fixed } from "../fixed";
import { FIXED_ONE } from "../fixed";
import type { VoxelTerrain } from "../terrain3d/api";
import { YAW_STEPS } from "./api";
import { cell } from "./critter";
import { isSolid } from "./terrainOps";
import { mulQ, yawDir } from "./vec3";

export type SteerFlight = "walk" | "drive" | "kite";

/** Steps a walker climbs without turning back. */
const WALK_STEP_UP = 2;

export interface SteerMove {
  x: Fixed;
  y: Fixed;
  z: Fixed;
  vx: Fixed;
  vy: Fixed;
  vz: Fixed;
  heading: number;
  /** True if a kite ran into terrain (it then drops its charge). */
  crashed: boolean;
}

/** Room for a walker (two voxels tall) at voxel (x, y, z). */
const clear = (t: VoxelTerrain, x: number, y: number, z: number): boolean =>
  !isSolid(t, x, y, z) && !isSolid(t, x, y + 1, z);

/**
 * One tick for a walker, racer or kite.
 * - `heading`: current heading (yaw steps). `steerYaw`: the owner's walk input, -1 for none.
 * - `speed`: ground or air speed per tick. `gravity`: per tick, for walkers off the ground.
 * - `wind`: per-tick push for kites, already scaled.
 */
export function steerStep(
  t: VoxelTerrain,
  flight: SteerFlight,
  pos: { x: Fixed; y: Fixed; z: Fixed },
  vel: { x: Fixed; y: Fixed; z: Fixed },
  heading: number,
  steerYaw: number,
  speed: Fixed,
  gravity: Fixed,
  wind: { x: Fixed; z: Fixed },
  terminal: Fixed,
): SteerMove {
  let { x, y, z } = pos;
  let vy = vel.y;
  if (flight !== "walk" && steerYaw >= 0) heading = steerYaw;

  if (flight === "kite") {
    // Level flight: any climb left from the launch dies away; the wind adds to the steering.
    const d = yawDir(heading);
    const vx = mulQ(d.x, speed) + wind.x;
    const vz = mulQ(d.z, speed) + wind.z;
    vy = (vy * 7) >> 3;
    const nx = x + vx;
    const ny = y + vy;
    const nz = z + vz;
    const crashed = isSolid(t, cell(nx), cell(ny), cell(nz));
    if (!crashed) {
      x = nx;
      y = ny;
      z = nz;
    }
    return { x, y, z, vx, vy, vz, heading, crashed };
  }

  const cx = cell(x);
  const cz = cell(z);
  const grounded = isSolid(t, cx, cell(y) - 1, cz);
  if (!grounded) {
    vy = Math.max(vy - gravity, -terminal);
    let ny = y + vy;
    // Land on the floor of the voxel above the first solid one.
    for (let yy = cell(y); yy >= cell(ny); yy--) {
      if (isSolid(t, cx, yy - 1, cz)) {
        ny = yy * FIXED_ONE;
        vy = 0;
        break;
      }
    }
    return { x, y: ny, z, vx: 0, vy, vz: 0, heading, crashed: false };
  }

  vy = 0;
  const moving = flight === "walk" || steerYaw >= 0;
  if (!moving) return { x, y, z, vx: 0, vy, vz: 0, heading, crashed: false };
  const d = yawDir(heading);
  const nx = x + mulQ(d.x, speed);
  const nz = z + mulQ(d.z, speed);
  for (let up = 0; up <= WALK_STEP_UP; up++) {
    const yy = cell(y) + up;
    if (clear(t, cell(nx), yy, cell(nz))) {
      return {
        x: nx,
        y: up === 0 ? y : yy * FIXED_ONE,
        z: nz,
        vx: mulQ(d.x, speed),
        vy,
        vz: mulQ(d.z, speed),
        heading,
        crashed: false,
      };
    }
  }
  // A wall: the robot turns back; a racer just stops against it.
  if (flight === "walk") heading = (heading + YAW_STEPS / 2) % YAW_STEPS;
  return { x, y, z, vx: 0, vy, vz: 0, heading, crashed: false };
}
