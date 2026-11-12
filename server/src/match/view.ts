// Server side of the view protocol (docs/view-protocol.md): turns the authoritative match into
// what a view client draws. The client never simulates, so everything it needs comes from here:
// the full world in match.start, then per 3-tick batch the sim events, a terrain.patch per edit,
// and a state with the critters that changed plus every projectile.

import type { MatchState, SimEvent } from "@burrow-brawl/shared";
import { encodeVoxels } from "@burrow-brawl/shared/src/net";
import type {
  ViewCritter,
  ViewProjectile,
  ViewServerMessage,
  ViewState,
  ViewTerrain,
} from "@burrow-brawl/shared/src/net/view";
import type { Critter, Projectile } from "@burrow-brawl/shared/src/sim3d";
import type { TerrainEdit, VoxelTerrain } from "@burrow-brawl/shared/src/terrain3d";

type Patch = Extract<ViewServerMessage, { t: "terrain.patch" }>;
type StateMsg = Extract<ViewServerMessage, { t: "state" }>;

export function viewCritter(c: Critter): ViewCritter {
  return {
    id: c.id,
    team: c.team,
    x: c.pos.x,
    y: c.pos.y,
    z: c.pos.z,
    yaw: c.yaw,
    hp: c.hp,
    status: c.status,
    grounded: c.grounded,
  };
}

export function viewProjectile(p: Projectile): ViewProjectile {
  return {
    id: p.id,
    ownerId: p.ownerId,
    weaponId: p.weaponId,
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z,
    fuseTicks: p.fuseTicks,
  };
}

/** Bytes of the box [x0, x0+sx) x [y0, y0+sy) x [z0, z0+sz), in protocol order. */
export function boxBytes(
  t: VoxelTerrain,
  x0: number,
  y0: number,
  z0: number,
  sx: number,
  sy: number,
  sz: number,
): Uint8Array {
  const out = new Uint8Array(sx * sy * sz);
  let o = 0;
  for (let y = y0; y < y0 + sy; y++)
    for (let z = z0; z < z0 + sz; z++) {
      const i = (y * t.sizeZ + z) * t.sizeX + x0;
      out.set(t.density.subarray(i, i + sx), o);
      o += sx;
    }
  return out;
}

/**
 * The grid box an edit can change, clamped to the grid, or null if it misses the grid. Spheres
 * reach r + 2 voxels: terrain3d's density falloff spans two voxels past the radius.
 */
export function editBox(
  t: VoxelTerrain,
  e: TerrainEdit,
): { x0: number; y0: number; z0: number; sx: number; sy: number; sz: number } | null {
  let lo: [number, number, number];
  let hi: [number, number, number];
  if (e.op === "box") {
    lo = [e.x0, e.y0, e.z0];
    hi = [e.x1, e.y1, e.z1];
  } else {
    const reach = e.r + 2;
    lo = [e.x - reach, e.y - reach, e.z - reach];
    hi = [e.x + reach, e.y + reach, e.z + reach];
  }
  const size = [t.sizeX, t.sizeY, t.sizeZ];
  const a = lo.map((v, i) => Math.max(0, Math.min(size[i]! - 1, v)));
  const b = hi.map((v, i) => Math.max(0, Math.min(size[i]! - 1, v)));
  for (let i = 0; i < 3; i++) if (hi[i]! < 0 || lo[i]! > size[i]! - 1) return null;
  return {
    x0: a[0]!,
    y0: a[1]!,
    z0: a[2]!,
    sx: b[0]! - a[0]! + 1,
    sy: b[1]! - a[1]! + 1,
    sz: b[2]! - a[2]! + 1,
  };
}

/**
 * Keeps what view clients were last told, so each batch carries only what changed. One stream
 * per match serves every view client: they all get every batch, and a (re)connecting one starts
 * from a full match.start.
 */
export class ViewStream {
  private readonly lastCritter = new Map<number, string>();
  private events: SimEvent[] = [];
  private sentEdits: number;
  private terrainCache: { edits: number; density: string } | null = null;

  constructor(state: MatchState) {
    this.sentEdits = state.sim.terrain.edits.length;
    for (const c of state.sim.critters) this.lastCritter.set(c.id, key(viewCritter(c)));
  }

  /** Record a step's events for the next batch. */
  record(events: readonly SimEvent[]): void {
    for (const e of events) this.events.push(e);
  }

  /** The whole world now: terrain, every critter, every projectile. */
  terrain(t: VoxelTerrain): ViewTerrain {
    if (this.terrainCache?.edits !== t.edits.length)
      this.terrainCache = { edits: t.edits.length, density: encodeVoxels(t.density) };
    return {
      sizeX: t.sizeX,
      sizeY: t.sizeY,
      sizeZ: t.sizeZ,
      seaY: t.seaY,
      bedrockY: t.bedrockY,
      density: this.terrainCache.density,
    };
  }

  fullState(s: MatchState): ViewState {
    return {
      tick: s.sim.tick,
      turns: s.turns,
      seaY: s.sim.seaY,
      critters: s.sim.critters.map(viewCritter),
      projectiles: s.sim.projectiles.map(viewProjectile),
      ammo: s.ammo,
    };
  }

  /** The batch for ticks since the last one, in protocol order: events, patches, state. */
  batch(s: MatchState): ViewServerMessage[] {
    const tick = s.sim.tick;
    const out: ViewServerMessage[] = [];
    if (this.events.length) out.push({ t: "events", tick, events: this.events });
    this.events = [];

    const t = s.sim.terrain;
    for (; this.sentEdits < t.edits.length; this.sentEdits++) {
      const box = editBox(t, t.edits[this.sentEdits]!);
      if (!box) continue;
      const bytes = boxBytes(t, box.x0, box.y0, box.z0, box.sx, box.sy, box.sz);
      const patch: Patch = { t: "terrain.patch", tick, ...box, density: encodeVoxels(bytes) };
      out.push(patch);
    }

    const critters: ViewCritter[] = [];
    for (const c of s.sim.critters) {
      const v = viewCritter(c);
      const k = key(v);
      if (this.lastCritter.get(c.id) === k) continue;
      this.lastCritter.set(c.id, k);
      critters.push(v);
    }
    const state: StateMsg = {
      t: "state",
      tick,
      turns: s.turns,
      seaY: s.sim.seaY,
      critters,
      projectiles: s.sim.projectiles.map(viewProjectile),
      ammo: s.ammo,
    };
    out.push(state);
    return out;
  }
}

const key = (c: ViewCritter): string =>
  `${c.x},${c.y},${c.z},${c.yaw},${c.hp},${c.status},${c.grounded ? 1 : 0},${c.team}`;
