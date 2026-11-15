import { isqrt } from "../../fixed.js";
import { PrefabBuilder, NX, NZ, PX, PZ, UP } from "../build/builder.js";
import { house, type HouseSpec } from "../build/house.js";
import { well } from "../build/pieces.js";
import {
  MAT_BRICK,
  MAT_GLASS,
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_PLASTER,
  MAT_SLATE,
  MAT_STONE,
} from "../materials.js";
import { type Prefab } from "../prefab.js";
import { pipeBridge, pipeShaft, put, SHAFT_R, STOREY, type PipeMats } from "./clockworkMesa.js";
import { fillFromHeightField, type Theme, type ThemeCtx } from "./kit.js";
import { withIslets } from "./layout.js";

// Bathtub Bay (v2, the layout Lucas approved on 2026-11-14): a chain of five soap-bar islands in
// the tub, every one of them joined to the others on foot.
//  - The Shampoo Tower (a giant bottle with a stair inside) stands on the biggest bar. From its
//    third floor a high pipe crosses the water to a shaft beside the bathhouse on the next bar.
//  - Low open gutter pipes with portholes link every other bar through a little hub bar in the
//    middle, so you can walk the whole chain; nothing ends in the water.
//  - A rubber-duck ferry floats in the bay between the southern bars.
// Laid out for a 256 grid and scaled with the grid (heights stay fixed). Integer maths only.

const SEABED = 14;
/** Top of every bar (walked at one above). */
const LEVEL = 36;
/** Soap bars rise this steeply from the seabed, so their sides read as a rounded bevel. */
const SLOPE = 4;
/** Rounded corner radius of the bars. */
const ROUND = 10;

/** A bar at the 256 layout: centre and half extents. */
interface Bar {
  readonly cx: number;
  readonly cz: number;
  readonly hx: number;
  readonly hz: number;
}

const TOWER_BAR: Bar = { cx: 72, cz: 86, hx: 46, hz: 30 };
const BATH_BAR: Bar = { cx: 188, cz: 74, hx: 32, hz: 24 };
const EAST_BAR: Bar = { cx: 196, cz: 164, hx: 34, hz: 22 };
const SOUTH_BAR: Bar = { cx: 86, cz: 196, hx: 32, hz: 20 };
const HUB_BAR: Bar = { cx: 122, cz: 142, hx: 28, hz: 16 };
const BARS = [TOWER_BAR, BATH_BAR, EAST_BAR, SOUTH_BAR, HUB_BAR];

const SHAMPOO: PipeMats = {
  body: MAT_PAINT_BLUE,
  stripe: MAT_PAINT_YELLOW,
  band: MAT_PAINT_WHITE,
  cap: MAT_PAINT_WHITE,
};
const PORCELAIN: PipeMats = {
  body: MAT_PAINT_WHITE,
  stripe: MAT_PAINT_BLUE,
  band: MAT_PAINT_BLUE,
  cap: MAT_PAINT_RED,
};

// ------------------------------------------------------------------------------------- prefabs

/** Copy a prefab into a taller builder so more can be added on top. */
function extend(p: Prefab, id: string, sy: number): PrefabBuilder {
  const b = new PrefabBuilder(id, p.sx, sy, p.sz);
  b.parts.push(...p.parts);
  b.anchors.push(...p.anchors);
  return b;
}

/**
 * The Shampoo Tower: a three-storey blue bottle (a pipe shaft inside, so it has the switchback
 * stair and the doors) with a white label, shoulders, a neck and a flip cap.
 */
export function shampooTower(doors: readonly (readonly [number, number])[]): Prefab {
  const shaft = pipeShaft(3, doors, SHAMPOO);
  const top = 3 * STOREY;
  const c = SHAFT_R;
  const b = extend(shaft, "shampoo-tower", top + 26);
  // The label: a white ring round the middle storey with a yellow stripe and a big drop on it.
  b.ring("paint", MAT_PAINT_WHITE, c, c, SHAFT_R, 1, STOREY + 3, 2 * STOREY - 2);
  b.ring("paint", MAT_PAINT_YELLOW, c, c, SHAFT_R, 1, STOREY + 8, STOREY + 9);
  b.anchor("plaque", c, STOREY + 10, 0, NZ);
  // Neck and cap above the shaft's dome.
  b.disc("solid", MAT_PAINT_WHITE, c, c, 4, top + 7, top + 15);
  b.disc("solid", MAT_PAINT_BLUE, c, c, 5, top + 16, top + 19);
  b.solid(MAT_PAINT_BLUE, c - 1, top + 20, c - 5, c + 1, top + 21, c + 1);
  b.anchor("weathervane", c, top + 22, c, UP);
  return b.build();
}

/** The bathhouse: a long soap-bar hall with a glass roof and a tiled pool inside. */
export function bathhouse(): Prefab {
  const b = new PrefabBuilder("bathhouse", 22, 18, 34);
  const x0 = 0;
  const x1 = 21;
  const z0 = 0;
  const z1 = 33;
  b.footing(MAT_STONE, x0, z0, x1, z1);
  b.solid(MAT_PLASTER, x0, 0, z0, x1, 12, z1);
  for (let k = 0; k < 3; k++)
    b.solid(MAT_PLASTER, x0 + 1 + k, 13 + k, z0 + 1 + k, x1 - 1 - k, 13 + k, z1 - 1 - k);
  b.air(x0 + 2, 1, z0 + 2, x1 - 2, 15, z1 - 2);
  b.solid(MAT_GLASS, x0 + 4, 15, z0 + 4, x1 - 4, 15, z1 - 4);
  // A sunken tiled pool.
  b.solid(MAT_PAINT_BLUE, x0 + 4, 0, z0 + 6, x1 - 4, 0, z1 - 6);
  b.ring("paint", MAT_PAINT_WHITE, 10, 16, 8, 1, 0, 0);
  b.paint(MAT_PAINT_WHITE, x0 + 4, 0, z0 + 6, x1 - 4, 0, z0 + 6);
  b.paint(MAT_PAINT_WHITE, x0 + 4, 0, z1 - 6, x1 - 4, 0, z1 - 6);
  for (let z = z0 + 4; z < z1 - 3; z += 7) {
    b.air(x1 - 1, 4, z, x1, 8, z + 2).anchor("window-round", x1, 3, z + 1, PX);
    b.air(x0, 4, z, x0 + 1, 8, z + 2).anchor("window-round", x0, 3, z + 1, NX);
  }
  // Doors at both ends: one to the shaft's side (-x), one to the bar's end (-z).
  b.air(x0, 1, 14, x0 + 1, 8, 18).anchor("door", x0, 1, 16, NX);
  b.air(8, 1, z0, 12, 8, z0 + 1)
    .anchor("door", 10, 1, z0, NZ)
    .anchor("awning", 10, 10, z0, NZ);
  b.anchor("lifebuoy", 4, 6, z0, NZ).anchor("lifebuoy", 16, 6, z0, NZ);
  b.anchor("ceiling-lamp", 10, 12, 10, 5).anchor("ceiling-lamp", 10, 12, 24, 5);
  b.anchor("bench", 3, 1, 10, UP).anchor("bench", 18, 1, 24, UP);
  return b.build();
}

/**
 * An open gutter pipe along +x, `len` long and 9 wide: a plank floor at local y 1 between low
 * porcelain walls with portholes, on stilts down to the seabed. Open on top, so it is walked like
 * a bridge and read like a pipe sliced in half.
 */
export function gutter(len: number): Prefab {
  const b = new PrefabBuilder("gutter-pipe", len, 5, 9);
  b.solid(MAT_PAINT_WHITE, 0, 0, 0, len - 1, 1, 8);
  b.solid(MAT_PLANKS, 0, 1, 1, len - 1, 1, 7);
  b.solid(MAT_PAINT_WHITE, 0, 2, 0, len - 1, 3, 0).solid(MAT_PAINT_WHITE, 0, 2, 8, len - 1, 3, 8);
  for (let x = 2; x < len - 2; x += 8) {
    b.paint(MAT_PAINT_BLUE, x, 0, 0, x + 1, 3, 8);
    b.anchor("porthole", x + 4, 1, 0, NZ).anchor("porthole", x + 4, 1, 8, PZ);
  }
  for (let x = 1; x < len - 1; x += 10) b.footing(MAT_PAINT_WHITE, x, 1, x + 1, 7);
  return b.build();
}

/** Rubber-duck ferry: a floating yellow duck with a deck on its back. */
export function duckFerry(): Prefab {
  const b = new PrefabBuilder("duck-ferry", 30, 26, 20);
  b.disc("solid", MAT_PAINT_YELLOW, 14, 10, 9, 0, 6);
  b.disc("solid", MAT_PAINT_YELLOW, 14, 10, 8, 7, 8);
  b.disc("air", 0, 14, 10, 6, 5, 8);
  b.solid(MAT_PLANKS, 9, 5, 5, 19, 5, 15);
  b.disc("solid", MAT_PAINT_YELLOW, 24, 10, 4, 9, 18);
  b.solid(MAT_PAINT_RED, 28, 12, 8, 29, 13, 12);
  b.solid(MAT_PAINT_WHITE, 27, 15, 7, 27, 16, 8).solid(MAT_PAINT_WHITE, 27, 15, 12, 27, 16, 13);
  b.solid(MAT_PAINT_YELLOW, 3, 7, 8, 6, 11, 12);
  for (let x = 9; x <= 19; x += 3) b.anchor("railing", x, 8, 3, UP).anchor("railing", x, 8, 17, UP);
  b.anchor("lifebuoy", 14, 4, 0, NZ).anchor("stern-flag", 4, 11, 10, UP);
  return b.build();
}

const HOUSES: readonly Omit<HouseSpec, "id">[] = [
  {
    w: 22,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_WHITE,
    trim: MAT_PAINT_BLUE,
    base: MAT_STONE,
    roof: "flat",
    roofMat: MAT_GLASS,
    garden: true,
  },
  {
    w: 20,
    d: 18,
    storeys: 3,
    wall: MAT_PLASTER,
    trim: MAT_PAINT_BLUE,
    base: MAT_STONE,
    roof: "hip",
    roofMat: MAT_SLATE,
    balcony: 2,
  },
  {
    w: 22,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_BLUE,
    trim: MAT_PAINT_WHITE,
    base: MAT_STONE,
    roof: "gable-x",
    roofMat: MAT_PAINT_WHITE,
    shop: true,
    sign: "sign-cafe",
  },
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_BRICK,
    trim: MAT_PAINT_WHITE,
    base: MAT_STONE,
    roof: "gable-z",
    roofMat: MAT_SLATE,
  },
];

function bathHouse(i: number): Prefab {
  return house({ ...HOUSES[i % HOUSES.length]!, id: `bathtub-${i}`, windowStep: 7 });
}

// --------------------------------------------------------------------------------------- build

/** The bay itself, on withIslets' CORE grid (256 square). */
function core(ctx: ThemeCtx): void {
  const { w, d, t } = ctx;
  const e = Math.min(w, d);
  const S = (v: number): number => Math.trunc((v * e) / 256);
  // The core grid is 256, so S is the identity; kept so the layout reads in 256 units.
  const ox = (w - e) >> 1;
  const oz = (d - e) >> 1;
  const bars = BARS.map((b) => ({
    cx: ox + S(b.cx),
    cz: oz + S(b.cz),
    hx: S(b.hx),
    hz: S(b.hz),
  }));
  const [tower, bath, east, south, hub] = bars as [Bar, Bar, Bar, Bar, Bar];

  // The bars: rounded rectangles with a steep bevel and a flat top.
  const inside = (x: number, z: number, b: Bar): number => {
    const qx = Math.abs(x - b.cx) - (b.hx - ROUND);
    const qz = Math.abs(z - b.cz) - (b.hz - ROUND);
    const outside =
      isqrt(Math.max(qx, 0) ** 2 + Math.max(qz, 0) ** 2) + Math.min(Math.max(qx, qz), 0);
    return ROUND - outside;
  };
  const hfs = new Int32Array(w * d).fill(SEABED * 256);
  for (const b of bars) {
    const reach = Math.max(b.hx, b.hz) + 2;
    for (let z = Math.max(0, b.cz - reach); z <= Math.min(d - 1, b.cz + reach); z++)
      for (let x = Math.max(0, b.cx - reach); x <= Math.min(w - 1, b.cx + reach); x++) {
        const s = inside(x, z, b);
        if (s <= 0) continue;
        const h = Math.min(LEVEL * 256 + 255, SEABED * 256 + s * 256 * SLOPE);
        if (h > hfs[z * w + x]!) hfs[z * w + x] = h;
      }
  }
  fillFromHeightField(t, hfs);
  const g = LEVEL;

  // The Shampoo Tower on the big bar and the shaft by the bathhouse, joined by the high pipe
  // at the third storey (walked at g + 1 + 2 * STOREY).
  const tx = tower.cx + S(20);
  const tz = tower.cz - S(10);
  const sx = bath.cx - S(18);
  put(
    ctx,
    shampooTower([
      [0, NX],
      [0, PZ],
      [2, PX],
    ]),
    tx,
    tz,
    0,
    4301,
    g,
  );
  put(
    ctx,
    pipeShaft(
      3,
      [
        [0, PX],
        [2, NX],
      ],
      PORCELAIN,
    ),
    sx,
    tz,
    0,
    4302,
    g,
  );
  const p0 = tx + SHAFT_R - 1;
  const p1 = sx - SHAFT_R + 1;
  ctx.stamp(
    pipeBridge(p1 - p0 + 1, MAT_PAINT_WHITE, MAT_PAINT_BLUE),
    p0,
    g + 2 * STOREY - 1,
    tz - 5,
    0,
    4303,
  );
  // The bathhouse beside the shaft, its side door facing it.
  put(ctx, bathhouse(), sx + SHAFT_R + 14, bath.cz, 0, 4304, g + 1);

  // Low gutter pipes: every bar joins the hub, and the bathhouse bar joins the east bar.
  // Each one runs ROUND + 4 onto the flat top of the bars at both ends.
  const runZ = (x: number, z0: number, z1: number, salt: number): void =>
    void ctx.stamp(gutter(z1 - z0 + 1), x - 4, g - 1, z0, 1, salt);
  const runX = (z: number, x0: number, x1: number, salt: number): void =>
    void ctx.stamp(gutter(x1 - x0 + 1), x0, g - 1, z - 4, 0, salt);
  const lap = ROUND + 4;
  const gx = hub.cx - S(16);
  runZ(gx, tower.cz + tower.hz - lap, hub.cz - hub.hz + lap, 4310);
  runZ(gx, hub.cz + hub.hz - lap, south.cz - south.hz + lap, 4311);
  runX(east.cz - east.hz + S(8), hub.cx + hub.hx - lap, east.cx - east.hx + lap, 4312);
  runZ(bath.cx + S(12), bath.cz + bath.hz - lap, east.cz - east.hz + lap, 4313);

  // Houses: two on the east bar, one on the south bar, one on the big bar, fronts to the pipes.
  put(ctx, bathHouse(ctx.rnd(4320, 0, 4)), east.cx - S(14), east.cz + S(8), 0, 4320, g + 1);
  put(ctx, bathHouse(ctx.rnd(4320, 1, 4) + 1), east.cx + S(18), east.cz + S(8), 0, 4321, g + 1);
  put(ctx, bathHouse(2), south.cx - S(12), south.cz + S(2), 2, 4322, g + 1);
  put(ctx, bathHouse(1), tower.cx - S(24), tower.cz + S(4), 1, 4323, g + 1);
  // The hub: a fountain well in the middle of the dish.
  put(ctx, well(), hub.cx + S(6), hub.cz, 0, 4330, g + 1);
  // The duck ferry, afloat in the bay between the southern bars.
  put(ctx, duckFerry(), ox + S(140), oz + S(200), 1, 4331, t.seaY - 4);

  const lampAt: [number, number][] = [
    [hub.cx - S(4), hub.cz - S(8)],
    [hub.cx + S(16), hub.cz + S(8)],
    [tower.cx - S(4), tower.cz - S(18)],
    [south.cx + S(18), south.cz - S(6)],
    [east.cx - S(2), east.cz - S(14)],
    [bath.cx + S(20), bath.cz - S(16)],
  ];
  lampAt.forEach(([x, z], i) => {
    const y = ctx.surf(x, z);
    if (y > t.seaY)
      ctx.decor.push({ kind: "lamp-post", x, y, z, face: UP, v: ctx.rnd(4340, i, 256) });
  });
}

export const bathtubBay: Theme = {
  id: "bathtub-bay",
  name: "Bathtub Bay",
  minSize: 384,
  sizeY: 128,
  build(ctx) {
    withIslets(ctx, core, {
      house: (i) =>
        house({
          ...HOUSES[i % HOUSES.length]!,
          id: `bathtub-islet-${i}`,
          storeys: 1,
          w: 18,
          d: 16,
          balcony: 0,
          garden: false,
          shop: false,
        }),
      salt: 4380,
      maxLevel: 40,
      // The bay is open water in the middle: look further along each side for a bar near the
      // edge, and never land an islet between the bars.
      shifts: [-72, -48, -24, 0, 24, 48, 72],
      reach: 64,
    });
  },
};
