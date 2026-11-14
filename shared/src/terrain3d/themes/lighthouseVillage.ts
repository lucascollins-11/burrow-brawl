// Lighthouse Village: a fishing town climbing four terraces from a harbour basin to a headland
// with a lighthouse. Every building is a stamped prefab with materials and detail anchors, so the
// client can draw plaster, timber, tile and stone apart and hang windows, lamps and nets on them.
//
// Layout (512 x 512, north = low z):
// - Headland (68), north-east, across a gorge: lighthouse, keeper's cottage, lookout, flagpole.
//   Reached by a stone arch bridge and a stair from Painted Row.
// - Painted Row (56): tall colourful townhouses with flat roofs, balconies and roof gardens.
// - Middle terrace (46), split by a ravine with a plank bridge: Timber Lane (timber-framed houses,
//   thatch and slate) to the west, Market Square (inn, shops, well) to the east.
// - Net Lane (37): stone fishermen's cottages, net sheds and a smokehouse.
// - Harbour (31): fish market, warehouses, cranes, boatyard with a hull on stilts and a slipway, a
//   long pier with a boathouse, a moored ferry, beach huts.
// Stone stairs join every terrace. Integer-only and seeded: house sizes, colours, roofs and
// features vary per lot, so no two streets look alike.

import { SOLID, type DecorAnchor } from "../api.js";
import { house, MARGIN, type HouseSpec, type RoofKind } from "../build/house.js";
import { LANDMARKS, turnToFace, type Landmark } from "../build/library.js";
import {
  archBridge,
  beachHut,
  crane,
  ferry,
  fishMarket,
  flagpole,
  hullOnStilts,
  lighthouse,
  netShed,
  pier,
  plankBridge,
  slipway,
  smokehouse,
  stairFlight,
  well,
} from "../build/pieces.js";
import {
  MAT_BRICK,
  MAT_COBBLE,
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_PLASTER,
  MAT_ROOF_TILE,
  MAT_SLATE,
  MAT_STONE,
  MAT_THATCH,
  MAT_TIMBER,
} from "../materials.js";
import { ensureMaterial, rotatedSize, type Prefab } from "../prefab.js";
import { octave, sample } from "../mapgen.js";
import { isqrt } from "../../fixed.js";
import {
  fillFromHeightField,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

const SEABED = 12;
const HARBOUR = 31;
const LOWER = 37;
const MIDDLE = 46;
const UPPER = 56;
const HEAD = 68;

// Band edges along z (north edge of each band, exclusive above).
const Z_MIDDLE = 150;
const Z_LOWER = 252;
const Z_HARBOUR = 320;
const Z_QUAY = 412; // harbour basin starts here
const BAY_X0 = 150;
const BAY_X1 = 420;
// Headland and the gorge that cuts it off.
const HEAD_X = 336;
const HEAD_Z = 168;
const GORGE_X0 = 322;
// Ravine across the middle terrace.
const RAV_X0 = 236;
const RAV_X1 = 247;

type Zone = 0 | 1 | 2; // 0 sea, 1 coast slope, 2 built-up band

interface Site {
  readonly t: ThemeCtx;
  readonly level: Int16Array; // column top
  readonly zone: Uint8Array;
  readonly used: Rect[];
}

function bandLevel(x: number, z: number): number {
  if (x >= HEAD_X && z < HEAD_Z) return HEAD;
  if (z < Z_MIDDLE) return UPPER;
  if (z < Z_LOWER) return MIDDLE;
  if (z < Z_HARBOUR) return LOWER;
  return HARBOUR;
}

function terrain(ctx: ThemeCtx): Site {
  const { t, w, d } = ctx;
  const wob = octave(ctx.seed, 901, w, d, 48);
  const fine = octave(ctx.seed, 902, w, d, 13);
  const hfs = new Int32Array(w * d);
  const level = new Int16Array(w * d);
  const zone = new Uint8Array(w * d);
  const cx = w >> 1;
  const cz = (d * 125) >> 8; // a little north of centre, leaving the basin to the south
  const R = (Math.min(w, d) * 119) >> 8; // ~238 at 512
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      // Distance to the centre in 1/256 of R, with a wobbly coast.
      const dx = x - cx;
      const dz = z - cz;
      const r = Math.floor(isqrt((dx * dx + dz * dz) * 65536) / R);
      const coast =
        256 - ((sample(wob, x, z) - 32768) >> 11) - ((sample(fine, x, z) - 32768) >> 13);
      let h = bandLevel(x, z);
      let hf = h * 256 + 255;
      let zn: Zone = 2;
      const inBay = z >= Z_QUAY && x >= BAY_X0 && x <= BAY_X1;
      if (r > coast || inBay) {
        hf = SEABED * 256 + ((sample(fine, x, z) * 3) >> 8);
        h = SEABED;
        zn = 0;
      } else if (r > coast - 22) {
        // The last stretch before the sea: a sloping beach below the lower bands, a cliff
        // otherwise (it just keeps its height until the sea takes it).
        zn = 1;
        if (h <= LOWER) {
          const p = Math.floor(((r - (coast - 22)) * 256) / 22);
          hf = h * 256 - p * (h - 20);
          h = hf >> 8;
        }
      }
      // Gorge in front of the headland and ravine across the middle terrace: water at the bottom.
      if (zn === 2 && x >= GORGE_X0 && x < HEAD_X && z < HEAD_Z + 6) {
        hf = 18 * 256;
        h = 18;
        zn = 0;
      }
      if (zn === 2 && x >= RAV_X0 && x <= RAV_X1 && z >= Z_MIDDLE && z < Z_LOWER) {
        hf = 20 * 256;
        h = 20;
        zn = 0;
      }
      hfs[i] = hf;
      level[i] = h;
      zone[i] = zn;
    }
  fillFromHeightField(t, hfs);
  return { t: ctx, level, zone, used: [] };
}

/** Stone retaining walls: paint every built-up terrace face (and the quay wall) stone. */
function retainingWalls(s: Site): void {
  const { t, w, d } = s.t;
  const mat = ensureMaterial(t);
  for (let z = 1; z < d - 1; z++)
    for (let x = 1; x < w - 1; x++) {
      const i = z * w + x;
      if (s.zone[i] !== 2) continue;
      const top = s.level[i]!;
      let low = top;
      for (const n of [i - 1, i + 1, i - w, i + w]) {
        const isQuay = s.zone[n] === 0 && top === HARBOUR;
        if (s.zone[n] === 2 || isQuay || (s.zone[n] === 0 && top >= UPPER))
          low = Math.min(low, s.level[n]!);
      }
      if (top - low < 4) continue;
      for (let y = Math.max(low - 2, t.bedrockY); y <= top; y++) {
        const k = (y * d + z) * w + x;
        if (t.density[k]! >= SOLID) mat[k] = (y + (x ^ z)) % 7 === 0 ? MAT_COBBLE : MAT_STONE;
      }
    }
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.z0 - gap <= b.z1 && b.z0 - gap <= a.z1;
}

/** True when every sampled column of the rectangle is built-up ground at `lvl`. */
function flatAt(s: Site, r: Rect, lvl: number): boolean {
  const { w, d } = s.t;
  if (r.x0 < 2 || r.z0 < 2 || r.x1 >= w - 2 || r.z1 >= d - 2) return false;
  for (let z = r.z0; z <= r.z1; z += 3)
    for (let x = r.x0; x <= r.x1; x += 3) {
      const i = z * w + x;
      if (s.zone[i] !== 2 || s.level[i] !== lvl) return false;
    }
  for (const [x, z] of [
    [r.x1, r.z1],
    [r.x0, r.z1],
    [r.x1, r.z0],
  ] as const) {
    const i = z * w + x;
    if (s.zone[i] !== 2 || s.level[i] !== lvl) return false;
  }
  return true;
}

/** Stamp a prefab so its rotated footprint's low corner is at (x, z), standing on `y`. */
function place(
  s: Site,
  p: Prefab,
  x: number,
  y: number,
  z: number,
  rot: number,
  salt: number,
  gap = 0,
): Rect {
  const [sx, sz] = rotatedSize(p, rot);
  const r = { x0: x, z0: z, x1: x + sx - 1, z1: z + sz - 1 };
  s.t.stamp(p, x, y + 1, z, rot, salt);
  s.used.push({ x0: r.x0 - gap, z0: r.z0 - gap, x1: r.x1 + gap, z1: r.z1 + gap });
  return r;
}

function free(s: Site, r: Rect, gap: number): boolean {
  return !s.used.some((u) => overlaps(r, u, gap));
}

function deco(
  s: Site,
  kind: string,
  x: number,
  y: number,
  z: number,
  face: number,
  i: number,
): void {
  const d: DecorAnchor = { kind, x, y, z, face, v: s.t.rnd(977, i, 256) };
  s.t.decor.push(d);
}

// ----------------------------------------------------------------------------------- districts

type Style = "painted" | "timber" | "stone" | "brick";

function spec(s: Site, style: Style, id: string, w: number, d: number, i: number): HouseSpec {
  const r = (salt: number, n: number) => s.t.rnd(700 + salt, i, n);
  const paints = [MAT_PAINT_BLUE, MAT_PAINT_YELLOW, MAT_PAINT_RED, MAT_PAINT_WHITE, MAT_PLASTER];
  switch (style) {
    case "painted": {
      const wall = paints[r(1, paints.length)]!;
      const roofs: RoofKind[] = ["flat", "flat", "hip", "gable-x"];
      const roof = roofs[r(2, roofs.length)]!;
      return {
        id,
        w,
        d,
        storeys: 3 + (r(3, 4) === 0 ? 1 : 0),
        wall,
        trim: wall === MAT_PAINT_WHITE ? MAT_PAINT_BLUE : MAT_PAINT_WHITE,
        base: MAT_STONE,
        roof,
        roofMat: r(4, 2) === 0 ? MAT_ROOF_TILE : MAT_SLATE,
        frame: "none",
        chimney: roof !== "flat" || r(5, 2) === 0,
        balcony: 1 + r(6, 2),
        shop: r(7, 3) === 0,
        garden: roof === "flat",
        windowStep: 6 + r(8, 2),
        flowerBoxes: r(9, 2) === 0,
        sign: "sign-cafe",
      };
    }
    case "timber":
      return {
        id,
        w,
        d,
        storeys: 2 + r(1, 2),
        wall: MAT_PLASTER,
        trim: MAT_TIMBER,
        base: MAT_STONE,
        roof: r(2, 2) === 0 ? "gable-x" : "gable-z",
        roofMat: r(3, 3) === 0 ? MAT_SLATE : r(3, 3) === 1 ? MAT_THATCH : MAT_ROOF_TILE,
        frame: "timber",
        chimney: true,
        balcony: r(4, 3) === 0 ? 1 : 0,
        shop: r(5, 4) === 0,
        windowStep: 7,
        flowerBoxes: true,
        sign: "sign-baker",
      };
    case "stone":
      return {
        id,
        w,
        d,
        storeys: 1 + r(1, 2),
        wall: MAT_STONE,
        trim: r(2, 2) === 0 ? MAT_PAINT_WHITE : MAT_PAINT_BLUE,
        base: MAT_STONE,
        roof: r(3, 3) === 0 ? "hip" : r(3, 3) === 1 ? "gable-z" : "gable-x",
        roofMat: MAT_SLATE,
        frame: "none",
        chimney: true,
        windowStep: 8,
        nets: true,
        flowerBoxes: r(4, 3) === 0,
      };
    default:
      return {
        id,
        w,
        d,
        storeys: 2 + r(1, 2),
        wall: MAT_BRICK,
        trim: MAT_PAINT_WHITE,
        base: MAT_STONE,
        roof: r(2, 2) === 0 ? "gable-z" : "hip",
        roofMat: MAT_ROOF_TILE,
        frame: "quoins",
        chimney: true,
        shop: r(3, 2) === 0,
        balcony: r(4, 2),
        windowStep: 7,
        sign: "sign-chandler",
      };
  }
}

/**
 * A street: a cobbled lane along x at z [laneZ0, laneZ1], houses on both sides facing it, from
 * xa to xb on the band at `lvl`. Lamps, benches, bunting and washing lines dress it.
 */
function street(
  s: Site,
  lvl: number,
  laneZ0: number,
  laneZ1: number,
  xa: number,
  xb: number,
  styles: readonly Style[],
  salt: number,
  rows: "both" | "north" | "south" = "both",
  maxDepth = 24,
): void {
  const { t } = s.t;
  const mat = ensureMaterial(t);
  const { w, d } = s.t;
  // Cobbles first (houses stamped later overwrite their own footprint).
  for (let z = laneZ0; z <= laneZ1; z++)
    for (let x = xa; x <= xb; x++) {
      const i = z * w + x;
      if (s.zone[i] !== 2 || s.level[i] !== lvl) continue;
      const k = (lvl * d + z) * w + x;
      if (t.density[k]! >= SOLID) mat[k] = (x + z) % 9 === 0 ? MAT_STONE : MAT_COBBLE;
    }
  let n = 0;
  for (const side of rows === "both" ? (["north", "south"] as const) : [rows]) {
    let x = xa + s.t.rnd(salt, side === "north" ? 1 : 2, 6);
    let i = 0;
    while (x < xb - 20) {
      const k = salt * 64 + i + (side === "north" ? 0 : 32);
      i++;
      const style = styles[s.t.rnd(salt + 3, k, styles.length)]!;
      const bw = 20 + s.t.rnd(salt + 4, k, 11);
      const bd = 16 + s.t.rnd(salt + 5, k, maxDepth - 15);
      // Body rectangle: front edge on the lane.
      const bz0 = side === "north" ? laneZ0 - bd : laneZ1 + 1;
      const body = { x0: x, z0: bz0, x1: x + bw - 1, z1: bz0 + bd - 1 };
      const lot = {
        x0: x - MARGIN,
        z0: bz0 - MARGIN,
        x1: x + bw - 1 + MARGIN,
        z1: bz0 + bd - 1 + MARGIN,
      };
      if (lot.x1 <= xb && flatAt(s, body, lvl) && free(s, lot, 1)) {
        const p = house(spec(s, style, `house-${salt}-${k}`, bw, bd, k));
        place(s, p, lot.x0, lvl, lot.z0, side === "north" ? 2 : 0, k);
        n++;
        x += bw + 2 + s.t.rnd(salt + 6, k, 5);
        backyard(s, body, side, lvl, k);
      } else x += 4;
    }
  }
  // Lamps and benches along the lane, bunting across it.
  for (let x = xa + 6, j = 0; x < xb - 4; x += 18, j++) {
    const zl = j & 1 ? laneZ0 : laneZ1;
    const i = zl * w + x;
    if (s.zone[i] !== 2 || s.level[i] !== lvl) continue;
    if (!free(s, { x0: x, z0: zl, x1: x, z1: zl }, 0)) continue;
    deco(s, j % 3 === 0 ? "bench" : "lamp-post", x, lvl, zl, 4, salt * 100 + j);
    if (j % 2 === 0) deco(s, "bunting", x, lvl, laneZ0, 1, salt * 100 + j + 50);
  }
  void n;
}

/** Behind a house: a washing line, a shed or a vegetable plot, a fence, a tree. */
function backyard(s: Site, body: Rect, side: "north" | "south", lvl: number, k: number): void {
  const z = side === "north" ? body.z0 - MARGIN - 3 : body.z1 + MARGIN + 3;
  const x = body.x0 + 2 + s.t.rnd(1201, k, Math.max(1, body.x1 - body.x0 - 4));
  const { w } = s.t;
  const i = z * w + x;
  if (z < 2 || z >= s.t.d - 2 || s.zone[i] !== 2 || s.level[i] !== lvl) return;
  const kinds = [
    "washing-line",
    "veg-plot",
    "garden-shed",
    "fence-run",
    "fruit-tree",
    "chicken-coop",
    "log-pile",
  ];
  deco(s, kinds[s.t.rnd(1202, k, kinds.length)]!, x, lvl, z, side === "north" ? 3 : 1, 1300 + k);
  deco(s, "fence-run", body.x0, lvl, z, side === "north" ? 3 : 1, 1400 + k);
}

/** A stair flight from band `lo` (south) up to band `hi` (north), its top landing at edgeZ - 1. */
function stairsNorth(
  s: Site,
  x: number,
  edgeZ: number,
  lo: number,
  hi: number,
  salt: number,
): void {
  const p = stairFlight(hi - lo, 5);
  place(s, p, x, lo, edgeZ - 2, 3, salt, 3);
}

function headland(s: Site): void {
  const ctx = s.t;
  // Lighthouse near the seaward edge, keeper's cottage and a lookout beside it.
  const lh = lighthouse();
  const lx = 404;
  const lz = 56;
  place(s, lh, lx, HEAD, lz, 0, 11, 2);
  const cot = house({
    id: "keepers-cottage",
    w: 26,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_WHITE,
    trim: MAT_PAINT_RED,
    base: MAT_STONE,
    roof: "gable-x",
    roofMat: MAT_SLATE,
    frame: "quoins",
    chimney: true,
    flowerBoxes: true,
    windowStep: 7,
  });
  place(s, cot, 352, HEAD, 104, 1, 12, 1);
  const look = house({
    id: "lookout",
    w: 18,
    d: 16,
    storeys: 2,
    wall: MAT_PAINT_WHITE,
    trim: MAT_PAINT_BLUE,
    base: MAT_STONE,
    roof: "flat",
    roofMat: MAT_SLATE,
    garden: false,
    windowStep: 6,
  });
  place(s, look, 440, HEAD, 112, 3, 13, 1);
  place(s, flagpole(), 396, HEAD, 120, 0, 14);
  deco(s, "fog-bell", 470, HEAD, 70, 4, 1);
  deco(s, "telescope-stand", 460, HEAD, 40, 4, 2);
  for (let i = 0; i < 8; i++) deco(s, "bench", 380 + i * 12, HEAD, 150 + (i & 1) * 4, 4, 3 + i);
  // Path cobbles from the stair to the lighthouse door.
  const mat = ensureMaterial(ctx.t);
  for (let x = 364; x <= 424; x++)
    for (let z = 96; z <= 100; z++) {
      const k = (HEAD * ctx.d + z) * ctx.w + x;
      if (ctx.t.density[k]! >= SOLID) mat[k] = MAT_COBBLE;
    }
  for (let z = 72; z <= 100; z++)
    for (let x = 418; x <= 422; x++) {
      const k = (HEAD * ctx.d + z) * ctx.w + x;
      if (ctx.t.density[k]! >= SOLID) mat[k] = MAT_COBBLE;
    }
  // The approach: an arch bridge over the gorge, then a stair up onto the headland.
  place(
    s,
    archBridge(GORGE_X0 - 310 + (HEAD_X - GORGE_X0) + 6, 9, 14),
    310,
    UPPER - 15,
    94,
    0,
    15,
    2,
  );
  place(s, stairFlight(HEAD - UPPER, 7), HEAD_X + 2, UPPER, 93, 0, 16, 2);
}

function harbour(s: Site): void {
  const ctx = s.t;
  const mat = ensureMaterial(ctx.t);
  // Cobbled quay everywhere on the harbour band.
  for (let z = Z_HARBOUR; z < ctx.d; z++)
    for (let x = 0; x < ctx.w; x++) {
      const i = z * ctx.w + x;
      if (s.zone[i] !== 2 || s.level[i] !== HARBOUR) continue;
      const k = (HARBOUR * ctx.d + z) * ctx.w + x;
      if (ctx.t.density[k]! >= SOLID) mat[k] = (x >> 2) % 5 === 0 ? MAT_STONE : MAT_COBBLE;
    }
  // Fish market on the quay.
  place(s, fishMarket(54, 34), 168, HARBOUR, 342, 0, 21, 3);
  // Warehouses, end-on to the water.
  for (let i = 0; i < 2; i++) {
    const p = house({
      id: `warehouse-${i}`,
      w: 30,
      d: 40,
      storeys: 2,
      wall: i ? MAT_BRICK : MAT_PLANKS,
      trim: MAT_PAINT_WHITE,
      base: MAT_STONE,
      roof: "gable-z",
      roofMat: i ? MAT_ROOF_TILE : MAT_SLATE,
      frame: i ? "quoins" : "none",
      windowStep: 8,
      sign: "sign-warehouse",
      shop: true,
    });
    place(s, p, 330 + i * 42, HARBOUR, 328, 2, 22 + i, 2);
  }
  // Cranes along the quay edge, jibs over the water.
  place(s, crane(), 250, HARBOUR, Z_QUAY - 18, 0, 24, 1);
  place(s, crane(), 384, HARBOUR, Z_QUAY - 18, 0, 25, 1);
  // Long pier with a boathouse at the end; the ferry moored alongside.
  const pierLen = 70;
  place(s, pier(pierLen, 12), 302, HARBOUR - 1, Z_QUAY, 0, 26);
  const boathouse = house({
    id: "boathouse",
    w: 22,
    d: 18,
    storeys: 1,
    wall: MAT_PLANKS,
    trim: MAT_PAINT_WHITE,
    base: MAT_TIMBER,
    roof: "gable-z",
    roofMat: MAT_SLATE,
    windowStep: 6,
    nets: true,
  });
  place(s, boathouse, 302 + 6 - (22 + 2 * MARGIN) / 2, HARBOUR, Z_QUAY + pierLen - 4, 0, 27);
  const fy = ferry();
  place(s, fy, 272, 19, Z_QUAY + 4, 0, 28);
  // Gangway from the pier to the ferry's main deck.
  ctx.box(296, HARBOUR - 1, Z_QUAY + 40, 302, HARBOUR, Z_QUAY + 44);
  for (let z = Z_QUAY + 40; z <= Z_QUAY + 44; z++)
    for (let x = 296; x <= 302; x++) {
      for (let y = HARBOUR - 1; y <= HARBOUR; y++) mat[(y * ctx.d + z) * ctx.w + x] = MAT_PLANKS;
    }
  deco(s, "gangway-rail", 299, HARBOUR, Z_QUAY + 40, 3, 30);
  // Boatyard west of the basin: a hull on stilts, a slipway into the basin, a shed.
  place(s, hullOnStilts(), 70, HARBOUR, 348, 0, 31, 2);
  place(s, slipway(36, 12, HARBOUR - 18), BAY_X0 - 30, 18, Z_QUAY - 6, 3, 32);
  place(s, netShed(), 104, HARBOUR, 336, 0, 33, 1);
  // Beach huts on the eastern beach, facing the sea.
  const paints = [MAT_PAINT_BLUE, MAT_PAINT_RED, MAT_PAINT_YELLOW, MAT_PAINT_WHITE];
  for (let i = 0; i < 6; i++) {
    const hx = 432 + i * 12;
    const hz = 372 + ((i * 7) % 3) * 3;
    if (
      flatAt(s, { x0: hx, z0: hz, x1: hx + 9, z1: hz + 9 }, HARBOUR) &&
      free(s, { x0: hx, z0: hz, x1: hx + 9, z1: hz + 9 }, 0)
    )
      place(s, beachHut(paints[i & 3]!), hx, HARBOUR, hz, 2, 40 + i);
  }
  // Quay dressing: bollards, crates, nets, lobster pots, barrels, a harbour-master's flag.
  for (let x = BAY_X0 + 4, j = 0; x < BAY_X1 - 2; x += 9, j++) {
    if (!free(s, { x0: x, z0: Z_QUAY - 2, x1: x, z1: Z_QUAY - 1 }, 0)) continue;
    const kinds = ["bollard", "crates", "net-pile", "lobster-pots", "barrels", "rope-coil"];
    deco(s, kinds[j % kinds.length]!, x, HARBOUR, Z_QUAY - 1, 1, 200 + j);
    if (j % 3 === 1) deco(s, "moored-boat", x, HARBOUR - 1, Z_QUAY - 1, 1, 260 + j);
  }
  place(s, flagpole(), 236, HARBOUR, 398, 0, 34);
  // Chandlers, a harbour office and sail lofts along the back of the quay, facing the water.
  street(s, HARBOUR, 356, 364, 14, 500, ["brick", "painted", "stone"], 35, "north", 26);
}

function lowerTown(s: Site): void {
  street(s, LOWER, 282, 291, 14, 500, ["stone", "stone", "timber"], 50, "both", 22);
  for (const [x, z] of [
    [40, 296],
    [196, 296],
    [430, 296],
  ] as const) {
    const r = { x0: x, z0: z, x1: x + 15, z1: z + 13 };
    if (free(s, r, 1) && flatAt(s, r, LOWER)) place(s, netShed(), x, LOWER, z, 2, x);
  }
  const sm = { x0: 300, z0: 296, x1: 317, z1: 311 };
  if (free(s, sm, 1) && flatAt(s, sm, LOWER)) place(s, smokehouse(), 300, LOWER, 296, 2, 51);
}

function middleTown(s: Site): void {
  // Ravine bridge on the lane, then the two halves.
  place(s, plankBridge(RAV_X1 - RAV_X0 + 7, 9), RAV_X0 - 3, MIDDLE - 2, 196, 0, 60);
  // Market square first (east of the ravine): inn, well, open cobbles.
  const inn = house({
    id: "inn",
    w: 34,
    d: 24,
    storeys: 3,
    wall: MAT_BRICK,
    trim: MAT_PAINT_WHITE,
    base: MAT_STONE,
    roof: "hip",
    roofMat: MAT_ROOF_TILE,
    frame: "quoins",
    chimney: true,
    balcony: 1,
    shop: true,
    sign: "sign-inn",
    windowStep: 7,
    flowerBoxes: true,
  });
  place(s, inn, 270, MIDDLE, 156, 2, 61, 1);
  const sq = { x0: 262, z0: 194, x1: 320, z1: 216 };
  const mat = ensureMaterial(s.t.t);
  for (let z = sq.z0; z <= sq.z1; z++)
    for (let x = sq.x0; x <= sq.x1; x++) {
      const k = (MIDDLE * s.t.d + z) * s.t.w + x;
      if (s.t.t.density[k]! >= SOLID) mat[k] = ((x >> 3) + (z >> 3)) & 1 ? MAT_COBBLE : MAT_STONE;
    }
  place(s, well(), 286, MIDDLE, 200, 0, 62, 2);
  deco(s, "market-cart", 270, MIDDLE, 210, 4, 63);
  deco(s, "market-cart", 310, MIDDLE, 200, 4, 64);
  deco(s, "notice-board", 300, MIDDLE, 196, 4, 65);
  s.used.push(sq);
  street(s, MIDDLE, 196, 205, RAV_X1 + 2, 506, ["brick", "timber", "painted"], 70, "both", 30);
  street(s, MIDDLE, 196, 205, 10, RAV_X0 - 2, ["timber", "timber", "brick"], 80, "both", 30);
}

function upperTown(s: Site): void {
  street(s, UPPER, 66, 75, 14, GORGE_X0 - 4, ["painted"], 90, "both", 28);
  // A promenade along the terrace edge with a view of the middle town.
  street(s, UPPER, Z_MIDDLE - 8, Z_MIDDLE - 1, 14, GORGE_X0 - 4, ["painted", "brick"], 95, "north");
  for (let x = 20; x < GORGE_X0 - 6; x += 4) deco(s, "railing", x, UPPER, Z_MIDDLE - 1, 4, 900 + x);
}

/**
 * Library landmarks (baked from CC0 models) on open ground: each goes to the free, flat spot
 * nearest its preferred point, doorway turned toward `face`. Skipped quietly when nothing fits.
 */
function landmarks(s: Site): void {
  const picks: readonly [Landmark, number, number, number, number][] = [
    // landmark, level, preferred x, preferred z, door faces
    [LANDMARKS.windmill, HEAD, 430, 128, 2],
    [LANDMARKS.church, MIDDLE, 460, 230, 3],
    [LANDMARKS.tower, UPPER, 100, 100, 3],
    [LANDMARKS.tavern, UPPER, 250, 100, 3],
    [LANDMARKS.watermill, MIDDLE, 140, 230, 3],
    [LANDMARKS.homeA, UPPER, 200, 44, 1],
    [LANDMARKS.homeB, MIDDLE, 380, 230, 3],
  ];
  // Lanes, the market square and the inn stay open (the town is built after the landmarks).
  const keep: Rect[] = [
    { x0: 0, z0: 66, x1: 511, z1: 75 },
    { x0: 0, z0: Z_MIDDLE - 8, x1: GORGE_X0, z1: Z_MIDDLE - 1 },
    { x0: 0, z0: 196, x1: 511, z1: 205 },
    { x0: 0, z0: 282, x1: 511, z1: 291 },
    { x0: 262, z0: 150, x1: 320, z1: 216 },
  ];
  picks.forEach(([l, lvl, px, pz, face], k) => {
    const rot = turnToFace(l, face);
    const [sx, sz] = rotatedSize(l.prefab, rot);
    let best: Rect | null = null;
    let bestD = Infinity;
    for (let dz = -48; dz <= 48; dz += 2)
      for (let dx = -64; dx <= 64; dx += 2) {
        const d = dx * dx + dz * dz;
        if (d >= bestD) continue;
        const x = px + dx - (sx >> 1);
        const z = pz + dz - (sz >> 1);
        const r = { x0: x, z0: z, x1: x + sx - 1, z1: z + sz - 1 };
        if (free(s, r, 3) && !keep.some((q) => overlaps(r, q, 4)) && flatAt(s, r, lvl)) {
          best = r;
          bestD = d;
        }
      }
    if (best) place(s, l.prefab, best.x0, lvl, best.z0, rot, 1200 + k, 2);
  });
}

function greenery(s: Site): void {
  const { t, w, d } = s.t;
  let n = 0;
  for (let i = 0; i < 2400 && n < 420; i++) {
    const x = 4 + s.t.rnd(990, i, w - 8);
    const z = 4 + s.t.rnd(991, i, d - 8);
    const c = z * w + x;
    if (s.zone[c] === 0) continue;
    const top = s.level[c]!;
    if (!free(s, { x0: x, z0: z, x1: x, z1: z }, 1)) continue;
    const k = (top * d + z) * w + x;
    if (t.density[k]! < SOLID || (t.material && t.material[k]) || t.density[k + w * d]! >= SOLID)
      continue;
    const roll = s.t.rnd(992, i, 10);
    deco(
      s,
      roll < 3 ? "tree" : roll < 6 ? "bush" : roll < 9 ? "flowers" : "rock",
      x,
      top,
      z,
      4,
      1000 + i,
    );
    n++;
  }
}

export const lighthouseVillage: Theme = {
  id: "lighthouse-village",
  name: "Lighthouse Village",
  minSize: 512,
  sizeY: 160,
  build(ctx) {
    const s = terrain(ctx);
    // Stairs between the terraces go in first so houses leave them clear.
    stairsNorth(s, 120, Z_MIDDLE, MIDDLE, UPPER, 101);
    stairsNorth(s, 292, Z_MIDDLE, MIDDLE, UPPER, 102);
    stairsNorth(s, 84, Z_LOWER, LOWER, MIDDLE, 103);
    stairsNorth(s, 200, Z_LOWER, LOWER, MIDDLE, 104);
    stairsNorth(s, 300, Z_LOWER, LOWER, MIDDLE, 105);
    stairsNorth(s, 440, Z_LOWER, LOWER, MIDDLE, 106);
    stairsNorth(s, 130, Z_HARBOUR, HARBOUR, LOWER, 107);
    stairsNorth(s, 256, Z_HARBOUR, HARBOUR, LOWER, 108);
    stairsNorth(s, 456, Z_HARBOUR, HARBOUR, LOWER, 109);
    // Keep the ravine banks and gorge rims clear of houses.
    s.used.push({ x0: RAV_X0 - 4, z0: Z_MIDDLE, x1: RAV_X1 + 4, z1: Z_LOWER });
    s.used.push({ x0: GORGE_X0 - 4, z0: 0, x1: HEAD_X + 2, z1: HEAD_Z + 6 });
    headland(s);
    harbour(s);
    // Landmarks claim their ground before the streets fill in around them.
    landmarks(s);
    middleTown(s);
    lowerTown(s);
    upperTown(s);
    retainingWalls(s);
    greenery(s);
    const lanes: Rect[] = [
      { x0: 20, z0: 66, x1: 300, z1: 75 },
      { x0: 20, z0: 196, x1: 500, z1: 205 },
      { x0: 20, z0: 282, x1: 500, z1: 291 },
      { x0: 160, z0: 380, x1: 400, z1: 405 },
    ];
    scatterObjects(ctx, lanes, 999);
  },
};

export const LIGHTHOUSE_PAINTS = [MAT_PAINT_RED, MAT_PAINT_WHITE];
