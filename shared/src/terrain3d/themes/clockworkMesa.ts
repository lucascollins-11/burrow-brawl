import { isqrt } from "../../fixed.js";
import { PrefabBuilder, NX, NZ, PX, PZ, UP } from "../build/builder.js";
import { house, type HouseSpec } from "../build/house.js";
import { stairFlight } from "../build/pieces.js";
import {
  MAT_BRICK,
  MAT_COBBLE,
  MAT_METAL,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_PLASTER,
  MAT_SLATE,
  MAT_STONE,
  MAT_TIMBER,
} from "../materials.js";
import { octave, sample } from "../mapgen.js";
import { rotatedSize, type Prefab } from "../prefab.js";
import {
  fillFromHeightField,
  pseudoAngle,
  scatterObjects,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Clockwork Mesa (v2, the layout Lucas approved on 2026-11-14): one tall mesa in three tiers
// (terraces at 46 and 62 cut into the cliffs, a gear-toothed top at 78) over a beach.
//  - The Clock Foundry is dug into the south cliff: its hall runs back into the rock and its clock
//    tower faces the sea.
//  - Stairs are cut into the cliffs on the east and west, one flight per tier.
//  - Two brass pipe shafts climb the north cliff with a stair inside. Each has a door on every
//    tier it passes, a catwalk across to the top, and a pipe bridge joins them high up. Nothing
//    leads nowhere.
//  - Brick workshops stand round a cobbled square on the top with the Great Gear in the middle.
// Every number is laid out for a 256 grid and scaled with the grid (heights stay fixed).
// Integer maths only: generation must match voxel for voxel everywhere.

const SEABED = 14;
/** Walk heights are one above these: beach, low terrace, mid terrace, top. */
const BEACH = 34;
const LOW = 46;
const MID = 62;
const TOP = 78;
/** Tier edges at the 256 layout: the top's rim (before its teeth), the mid and low terraces, shore. */
const R_TOP = 64;
const R_MID = 80;
const R_LOW = 98;
const R_SHORE = 118;
const TEETH = 24;
const TOOTH = 4;

// ------------------------------------------------------------------------------------ helpers

/** A disc standing in the x-y plane (a clock face, a gear), z0..z1 thick. */
function faceDisc(
  b: PrefabBuilder,
  op: "solid" | "air" | "paint",
  mat: number,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  z1: number,
): void {
  const rr = r * r + r;
  for (let dy = -r; dy <= r; dy++) {
    const half = isqrt(rr - dy * dy);
    if (op === "solid") b.solid(mat, cx - half, cy + dy, z0, cx + half, cy + dy, z1);
    else if (op === "air") b.air(cx - half, cy + dy, z0, cx + half, cy + dy, z1);
    else b.paint(mat, cx - half, cy + dy, z0, cx + half, cy + dy, z1);
  }
}

/** Gear teeth round a face disc: eight lumps at the compass and diagonal points. */
const TOOTH_DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

function gearFace(
  b: PrefabBuilder,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  z1: number,
  hub = MAT_PAINT_YELLOW,
): void {
  faceDisc(b, "solid", MAT_METAL, cx, cy, r, z0, z1);
  faceDisc(b, "paint", hub, cx, cy, r - 2, z0, z1);
  faceDisc(b, "solid", MAT_METAL, cx, cy, 1, z0 - 1, z1);
  // Spokes: the hub colour shows between four metal arms.
  b.paint(MAT_METAL, cx - r + 2, cy, z0, cx + r - 2, cy, z1);
  b.paint(MAT_METAL, cx, cy - r + 2, z0, cx, cy + r - 2, z1);
  for (const [dx, dy] of TOOTH_DIRS) {
    // Diagonals sit a little further in so the ring reads round.
    const k = dx !== 0 && dy !== 0 ? (r * 3) >> 2 : r + 1;
    const tx = cx + dx * k + (dx !== 0 && dy !== 0 ? dx : 0);
    const ty = cy + dy * k + (dx !== 0 && dy !== 0 ? dy : 0);
    b.solid(MAT_METAL, tx - 1, ty - 1, z0, tx + 1, ty + 1, z1);
  }
}

/** Clear a box to open air (generation only: writes the grid directly, like the heightfield). */
function clearBox(
  ctx: ThemeCtx,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const { t, w, d, h } = ctx;
  for (let y = Math.max(y0, t.bedrockY); y <= Math.min(y1, h - 1); y++)
    for (let z = Math.max(0, z0); z <= Math.min(d - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const k = (y * d + z) * w + x;
        t.density[k] = 0;
        if (t.material) t.material[k] = 0;
      }
}

/** Stamp a prefab with its rotated footprint centred on (cx, cz), its local y 0 at world y. */
export function put(
  ctx: ThemeCtx,
  p: Prefab,
  cx: number,
  cz: number,
  rot: number,
  salt: number,
  y: number,
) {
  const [sx, sz] = rotatedSize(p, rot);
  ctx.stamp(p, cx - (sx >> 1), y, cz - (sz >> 1), rot, salt);
}

// ------------------------------------------------------------------------------------- prefabs

/**
 * The Clock Foundry: a two-storey workshop hall (front on local -z) with gears on its wall, and
 * beside it a 64-tall clock tower with a clock face on three sides, a climb inside and a belfry.
 */
export function clockFoundry(): Prefab {
  const b = new PrefabBuilder("clock-foundry", 48, 80, 48);
  b.footing(MAT_STONE, 2, 2, 45, 45);
  // Workshop hall: 40 x 22, two storeys, slate roof steps, big gears on the long wall.
  const h0 = 4;
  const h1 = 43;
  const z0 = 22;
  const z1 = 43;
  b.solid(MAT_BRICK, h0, 0, z0, h1, 22, z1);
  b.air(h0 + 2, 1, z0 + 2, h1 - 2, 20, z1 - 2);
  b.solid(MAT_PLANKS, h0 + 2, 11, z0 + 2, h1 - 2, 11, z1 - 2);
  // Stairs to the upper floor along the back wall, and the hole they climb through.
  for (let j = 0; j < 11; j++)
    b.solid(MAT_TIMBER, h1 - 4 - j, 1, z1 - 4, h1 - 4 - j, 1 + j, z1 - 2);
  b.air(h1 - 15, 11, z1 - 4, h1 - 4, 11, z1 - 2);
  for (let k = 0; k < 8; k++)
    b.solid(MAT_SLATE, h0 - 1 + k, 23 + k, z0 - 1 + k, h1 + 1 - k, 23 + k, z1 + 1 - k);
  for (const y of [4, 14])
    for (let x = h0 + 4; x < h1 - 3; x += 7) {
      b.air(x, y, z1 - 1, x + 2, y + 4, z1).anchor("window", x + 1, y - 1, z1, PZ);
    }
  // Gears on the front (-z) wall of the hall.
  gearFace(b, 31, 13, 7, z0 - 2, z0 - 1);
  gearFace(b, 40, 6, 4, z0 - 2, z0 - 1, MAT_PAINT_RED);
  // Workbenches and furnaces inside.
  b.anchor("sawhorse", 12, 1, z0 + 5, UP).anchor("crates", 18, 1, z0 + 8, UP);
  b.anchor("oil-barrels", 34, 1, z1 - 6, UP).anchor("barrels", 22, 12, z0 + 6, UP);
  b.anchor("ceiling-lamp", 20, 10, z0 + 10, 5).anchor("ceiling-lamp", 30, 20, z0 + 10, 5);
  // Clock tower: 14 x 14, 64 tall, brick with brass bands, a clock face on three sides.
  const t0 = 6;
  const t1 = 19;
  const tc = 12;
  b.solid(MAT_BRICK, t0, 0, t0, t1, 62, t1);
  for (let y = 10; y < 62; y += 12) b.paint(MAT_METAL, t0, y, t0, t1, y + 1, t1);
  b.air(t0 + 2, 1, t0 + 2, t1 - 2, 60, t1 - 2);
  // A switchback climb: a one-wide step every voxel up, turning at each wall.
  for (let y = 1; y < 58; y++) {
    const k = (y - 1) % 16;
    const [x, z] =
      k < 4
        ? [t0 + 2 + k * 2, t0 + 2]
        : k < 8
          ? [t1 - 3, t0 + 2 + (k - 4) * 2]
          : k < 12
            ? [t1 - 3 - (k - 8) * 2, t1 - 3]
            : [t0 + 2, t1 - 3 - (k - 12) * 2];
    b.solid(MAT_TIMBER, x, y - 1, z, x + 1, y - 1, z + 1);
  }
  faceDisc(b, "solid", MAT_PAINT_WHITE, tc, 50, 5, t0 - 1, t0 - 1);
  faceDisc(b, "solid", MAT_METAL, tc, 50, 0, t0 - 2, t0 - 2);
  b.solid(MAT_METAL, tc, 50, t0 - 2, tc, 54, t0 - 2);
  b.solid(MAT_METAL, tc, 50, t0 - 2, tc + 3, 50, t0 - 2);
  b.solid(MAT_PAINT_WHITE, t1 + 1, 45, tc - 5, t1 + 1, 55, tc + 5);
  b.solid(MAT_PAINT_WHITE, t0 - 1, 45, tc - 5, t0 - 1, 55, tc + 5);
  b.anchor("clock-face", tc, 50, t0 - 2, NZ);
  // Belfry: open arches, a slate cap stepping in to a spire.
  b.air(t0, 57, t0 + 4, t1, 61, t1 - 4);
  b.air(t0 + 4, 57, t0, t1 - 4, 61, t1);
  for (let k = 0; k < 7; k++)
    b.solid(MAT_SLATE, t0 - 1 + k, 63 + k * 2, t0 - 1 + k, t1 + 1 - k, 64 + k * 2, t1 + 1 - k);
  b.anchor("weathervane", tc, 76, tc, UP).anchor("bell", tc, 57, tc, UP);
  b.air(tc - 2, 1, t0, tc + 2, 8, t0 + 1).anchor("door", tc, 1, t0, NZ);
  for (let y = 16; y < 44; y += 11) {
    b.air(tc - 1, y, t1 - 1, tc + 1, y + 4, t1).anchor("window-arched", tc, y - 1, t1, PZ);
    b.air(t1 - 1, y, tc - 1, t1, y + 4, tc + 1).anchor("window-arched", t1, y - 1, tc, PX);
  }
  // Chimneys with smoke, a steam pipe along the roof.
  b.solid(MAT_BRICK, 36, 23, 30, 39, 40, 33).anchor("chimney-pot", 37, 40, 31, UP);
  b.solid(MAT_BRICK, 26, 23, 36, 28, 36, 38).anchor("chimney-pot", 27, 36, 37, UP);
  b.solid(MAT_METAL, 20, 26, 33, 36, 27, 34);
  b.air(22, 1, z0, 26, 8, z0 + 1)
    .anchor("door", 24, 1, z0, NZ)
    .anchor("sign-warehouse", 28, 10, z0, NZ);
  return b.build();
}

/** Inner storey height of the pipe shafts: matches the gap between the tiers. */
export const STOREY = 16;
export const SHAFT_R = 13;

/**
 * A brass pipe shaft: a round tower SHAFT_R in radius, `storeys` storeys of STOREY, a switchback
 * stair inside (one flight per storey, through a gap in the floor above) and a door wherever
 * `doors` says: [storey, face] pairs (faces in local terms). Local y 0 is the plinth; storey k is
 * walked at local 1 + k * STOREY.
 */
export interface PipeMats {
  readonly body: number;
  /** The stripe near the top of every storey. */
  readonly stripe: number;
  /** The band at the foot of every storey. */
  readonly band: number;
  /** The little cap on the dome. */
  readonly cap: number;
}

const BRASS: PipeMats = {
  body: MAT_METAL,
  stripe: MAT_PAINT_YELLOW,
  band: MAT_BRICK,
  cap: MAT_PAINT_RED,
};

export function pipeShaft(
  storeys: number,
  doors: readonly (readonly [number, number])[],
  mats: PipeMats = BRASS,
): Prefab {
  const R = SHAFT_R;
  const c = R;
  const top = storeys * STOREY;
  const b = new PrefabBuilder("pipe-shaft", 2 * R + 1, top + 10, 2 * R + 1);
  b.footing(MAT_STONE, 1, 1, 2 * R - 1, 2 * R - 1);
  b.disc("solid", MAT_STONE, c, c, R, 0, 0);
  b.disc("solid", mats.body, c, c, R, 1, top + 1);
  for (let k = 0; k < storeys; k++)
    b.disc("air", 0, c, c, R - 2, 1 + k * STOREY, (k + 1) * STOREY - 2);
  // Riveted bands and a yellow stripe every storey.
  for (let k = 0; k < storeys; k++) {
    b.ring("paint", mats.stripe, c, c, R, 2, k * STOREY + 12, k * STOREY + 13);
    b.ring("paint", mats.band, c, c, R, 2, k * STOREY + 1, k * STOREY + 2);
  }
  for (let k = 0; k < storeys; k++) {
    const yb = 1 + k * STOREY;
    const lane = k & 1 ? c - 6 : c + 4;
    const dir = k & 1 ? -1 : 1;
    if (k < storeys - 1) {
      for (let j = 0; j < STOREY; j++) {
        const x = c + dir * (j - 8);
        b.solid(MAT_TIMBER, x, yb, lane, x, yb + j - 1, lane + 2);
      }
      const xa = c - 8 * dir;
      const xb = c + 7 * dir;
      b.air(Math.min(xa, xb), yb + STOREY - 2, lane, Math.max(xa, xb), yb + STOREY - 1, lane + 2);
      b.anchor("stair-rail", c, yb + 8, lane + (k & 1 ? 2 : 0), k & 1 ? PZ : NZ);
    }
    b.anchor("ceiling-lamp", c, yb + STOREY - 3, c, 5);
    b.anchor("warning-light", c - 4, yb + 2, c - 4, UP);
  }
  // Doors: 5 wide, 8 tall, cut through the wall at the storey's floor.
  for (const [k, face] of doors) {
    const y = 1 + k * STOREY;
    if (face === NZ) b.air(c - 2, y, 0, c + 2, y + 7, 2).anchor("door", c, y, 0, NZ);
    if (face === PZ)
      b.air(c - 2, y, 2 * R - 2, c + 2, y + 7, 2 * R).anchor("door", c, y, 2 * R, PZ);
    if (face === NX) b.air(0, y, c - 2, 2, y + 7, c + 2).anchor("door", 0, y, c, NX);
    if (face === PX)
      b.air(2 * R - 2, y, c - 2, 2 * R, y + 7, c + 2).anchor("door", 2 * R, y, c, PX);
  }
  // Portholes between the doors, a domed cap with a valve wheel and a steam vent.
  for (let k = 0; k < storeys; k++) {
    const y = k * STOREY + 7;
    b.anchor("porthole", c + R, y, c + 6, PX).anchor("porthole", c - R, y, c - 6, NX);
  }
  for (let i = 0; i < 5; i++) b.disc("solid", mats.body, c, c, R - 2 * i, top + 2 + i, top + 2 + i);
  b.disc("solid", mats.cap, c, c, 2, top + 7, top + 8);
  b.anchor("warning-light", c, top + 9, c, UP).anchor("chimney-pot", c + 5, top + 4, c, UP);
  return b.build();
}

/**
 * A walkable brass pipe along +x, `len` long: 11 x 11 outside, 7 wide and 8 tall inside on a plank
 * floor at local y 1, open at both ends, with portholes along both sides.
 */
export function pipeBridge(len: number, body = MAT_METAL, band = MAT_PAINT_YELLOW): Prefab {
  const b = new PrefabBuilder("pipe-bridge", len, 11, 11);
  // An octagon in section: a tall box and a wide box, then the bore.
  b.solid(body, 0, 0, 2, len - 1, 10, 8).solid(body, 0, 2, 0, len - 1, 8, 10);
  b.solid(body, 0, 1, 1, len - 1, 9, 9);
  b.air(0, 2, 2, len - 1, 9, 8);
  b.solid(MAT_PLANKS, 0, 1, 2, len - 1, 1, 8);
  for (let x = 3; x < len - 3; x += 9) {
    b.paint(band, x, 0, 0, x + 1, 10, 10);
    b.air(x + 4, 5, 0, x + 6, 6, 1).air(x + 4, 5, 9, x + 6, 6, 10);
    b.anchor("porthole", x + 5, 4, 0, NZ).anchor("porthole", x + 5, 4, 10, PZ);
  }
  b.anchor("warning-light", len >> 1, 10, 5, UP);
  return b.build();
}

/** A catwalk along +x: a metal deck at local y 0 on struts to the ground, rails on both sides. */
export function catwalk(len: number): Prefab {
  const b = new PrefabBuilder("catwalk", len, 6, 5);
  b.solid(MAT_METAL, 0, 0, 0, len - 1, 0, 4);
  for (let x = 2; x < len - 1; x += 8) b.footing(MAT_METAL, x, 2, x, 2);
  for (let x = 1; x < len - 1; x += 3)
    b.anchor("railing", x, 0, 0, UP).anchor("railing", x, 0, 4, UP);
  return b.build();
}

/** The Great Gear: a big upright cogwheel on a stone plinth in the middle of the square. */
export function greatGear(): Prefab {
  const b = new PrefabBuilder("great-gear", 27, 30, 11);
  b.footing(MAT_STONE, 1, 1, 25, 9);
  b.solid(MAT_STONE, 1, 0, 1, 25, 2, 9);
  b.solid(MAT_STONE, 9, 3, 3, 17, 5, 7);
  gearFace(b, 13, 16, 10, 4, 6);
  gearFace(b, 21, 7, 4, 7, 7, MAT_PAINT_RED);
  b.anchor("plaque", 13, 3, 1, NZ)
    .anchor("lamp-post", 2, 2, 2, UP)
    .anchor("lamp-post", 24, 2, 8, UP);
  return b.build();
}

/** A paved disc one voxel thick, laid over the ground it is stamped on. */
function plaza(r: number): Prefab {
  const b = new PrefabBuilder("square", 2 * r + 1, 1, 2 * r + 1);
  b.disc("solid", MAT_COBBLE, r, r, r, 0, 0);
  b.ring("paint", MAT_STONE, r, r, r, 2, 0, 0);
  return b.build();
}

const WORKSHOPS: readonly Omit<HouseSpec, "id">[] = [
  {
    w: 22,
    d: 18,
    storeys: 3,
    wall: MAT_BRICK,
    trim: MAT_METAL,
    base: MAT_STONE,
    roof: "gable-x",
    roofMat: MAT_SLATE,
    chimney: true,
    frame: "quoins",
  },
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_PLASTER,
    trim: MAT_METAL,
    base: MAT_STONE,
    roof: "hip",
    roofMat: MAT_SLATE,
    shop: true,
    sign: "sign-chandler",
    chimney: true,
  },
  {
    w: 22,
    d: 18,
    storeys: 3,
    wall: MAT_BRICK,
    trim: MAT_PAINT_YELLOW,
    base: MAT_STONE,
    roof: "flat",
    roofMat: MAT_METAL,
    garden: true,
    balcony: 2,
  },
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_STONE,
    trim: MAT_METAL,
    base: MAT_STONE,
    roof: "gable-z",
    roofMat: MAT_SLATE,
    chimney: true,
  },
];

function workshop(i: number): Prefab {
  return house({ ...WORKSHOPS[i % WORKSHOPS.length]!, id: `clockwork-${i}`, windowStep: 7 });
}

// --------------------------------------------------------------------------------------- build

export const clockworkMesa: Theme = {
  id: "clockwork-mesa",
  name: "Clockwork Mesa",
  minSize: 256,
  sizeY: 128,
  build(ctx) {
    const { w, d, t } = ctx;
    const e = Math.min(w, d);
    /** A 256-layout distance at this grid's scale. */
    const S = (v: number): number => Math.trunc((v * e) / 256);
    const cx = w >> 1;
    const cz = (d >> 1) - S(4);
    const o = octave(ctx.seed, 4201, w, d, 32);
    const wob = (x: number, z: number): number =>
      Math.trunc(((sample(o, x, z) - 32768) * 5) / 32768);

    // The mesa: a wobbly round shore, three cliffs, and a gear-toothed rim on the top tier.
    const rTop = S(R_TOP);
    const rMid = S(R_MID);
    const rLow = S(R_LOW);
    const rShore = S(R_SHORE);
    const hfs = new Int32Array(w * d);
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dz = z - cz;
        // The tiers are machined true circles; only the shore wobbles.
        const r = isqrt(dx * dx + dz * dz);
        const tooth = ((pseudoAngle(dx, dz) * TEETH) >> 12) & 1 ? TOOTH : 0;
        const level = r < rTop + tooth ? TOP : r < rMid ? MID : r < rLow ? LOW : BEACH;
        const top = level * 256 + 255;
        const s = rShore - r - wob(x, z);
        hfs[z * w + x] = s <= 0 ? SEABED * 256 : Math.min(top, SEABED * 256 + s * 512);
      }
    fillFromHeightField(t, hfs);

    // The Clock Foundry, dug into the south cliff: hall in the rock, clock tower to the sea.
    put(ctx, clockFoundry(), cx, cz + S(R_LOW) - 19, 2, 4201, LOW + 1);

    // Cliff stairs on the east and west: one flight per tier, cut tangentially into each cliff,
    // switching direction from tier to tier.
    const flights: [edge: number, lo: number, hi: number][] = [
      [rLow, BEACH, LOW],
      [rMid, LOW, MID],
      [rTop, MID, TOP],
    ];
    for (const side of [1, -1]) {
      flights.forEach(([edge, lo, hi], i) => {
        const up = (i + (side > 0 ? 0 : 1)) & 1 ? 3 : 1; // 1 climbs +z, 3 climbs -z
        // Open the cut to the sky first, so the flight is a notch in the cliff, not a tunnel.
        const sx0 = cx + side * (edge - 3);
        const half = hi - lo + 1;
        const outer = sx0 + side * 3; // the column on the low terrace side stays open too
        clearBox(
          ctx,
          Math.min(sx0 - 2, outer),
          lo + 1,
          cz - half,
          Math.max(sx0 + 2, outer),
          hi + 12,
          cz + half - 1,
        );
        put(ctx, stairFlight(hi - lo, 5, MAT_STONE), sx0, cz, up, 4210 + i, lo + 1);
      });
    }

    // Two pipe shafts on the low terrace against the north cliff. Each has a door to the low
    // terrace (north), one onto the mid terrace (south), one to a catwalk across to the top, and
    // one into the pipe bridge that joins the two high up.
    const sx = S(40);
    const rShaft = S(89);
    const sz = cz - isqrt(rShaft * rShaft - sx * sx);
    for (const side of [-1, 1]) {
      const toBridge = side < 0 ? PX : NX;
      const shaft = pipeShaft(4, [
        [0, NZ],
        [1, PZ],
        [2, PZ],
        [3, toBridge],
      ]);
      put(ctx, shaft, cx + side * sx, sz, 0, 4220 + side, LOW);
      // Catwalk from the shaft's third-storey door to the top tier's rim.
      const z0 = sz + SHAFT_R - 1;
      const x = cx + side * sx;
      const rimZ = cz - isqrt(Math.max(0, (rTop - 2) * (rTop - 2) - sx * sx));
      const len = Math.max(4, rimZ - z0 + 4);
      ctx.stamp(catwalk(len), x - 2, TOP, z0, 1, 4224 + side);
    }
    const span = 2 * (sx - SHAFT_R) + 4;
    ctx.stamp(pipeBridge(span), cx - (span >> 1), LOW + 3 * STOREY - 1, sz - 5, 0, 4227);

    // Workshops round a cobbled square on the top, the Great Gear in the middle.
    put(ctx, plaza(S(26)), cx, cz, 0, 4230, TOP);
    put(ctx, greatGear(), cx, cz, 0, 4231, TOP + 1);
    const off = S(31);
    const spots: [number, number, number][] = [
      [cx - off, cz - off, 2],
      [cx + off, cz - off, 2],
      [cx - off, cz + off, 0],
      [cx + off, cz + off, 0],
    ];
    spots.forEach(([x, z, rot], i) =>
      put(ctx, workshop(i + ctx.rnd(4232, 0, 4)), x, z, rot, 4240 + i, TOP + 1),
    );
    // On bigger grids the terraces are wide enough for a lower town on the low terrace.
    if (rLow - rMid >= 30) {
      const ring = Math.trunc(((rLow + rMid) >> 1) * 181) >> 8; // * cos 45
      [
        [cx + ring, cz + ring, 3],
        [cx - ring, cz + ring, 1],
      ].forEach(([x, z, rot], i) => put(ctx, workshop(i + 1), x!, z!, rot!, 4250 + i, LOW + 1));
    }

    // Street lamps round the square and along the terraces.
    const lampAt: [number, number][] = [
      [cx - S(18), cz],
      [cx + S(18), cz],
      [cx, cz - S(18)],
      [cx, cz + S(18)],
      [cx - S(70), cz + S(30)],
      [cx + S(70), cz - S(30)],
      [cx + S(30), cz + S(88)],
      [cx - S(55), cz + S(72)],
    ];
    lampAt.forEach(([x, z], i) => {
      const y = ctx.surf(x, z);
      if (y > t.seaY)
        ctx.decor.push({ kind: "lamp-post", x, y, z, face: UP, v: ctx.rnd(4260, i, 256) });
    });

    scatterObjects(
      ctx,
      [
        { x0: cx - rLow, z0: cz - rLow, x1: cx + rLow, z1: cz + rLow },
        { x0: cx - rTop, z0: cz - rTop, x1: cx + rTop, z1: cz + rTop },
      ],
      250,
    );
  },
};
