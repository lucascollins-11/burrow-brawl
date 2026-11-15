// Toybox Harbor: a block harbour split by a channel. Two flat, square-edged block halves, a raised
// tier in the north-west and a step in the east; the Block Keep is built across the channel and
// its ground floor is the passage between the halves. Houses stack on each other like building
// blocks, a long pier arm runs south with moored boats and a crane, and bridged islets ring it all.
// Everything is voxels with detail anchors, so it all comes apart under fire.
import { NX, NZ, PX, PZ, PrefabBuilder, UP } from "../build/builder.js";
import { house, type HouseSpec } from "../build/house.js";
import { crane, plankBridge, stairFlight } from "../build/pieces.js";
import {
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_TIMBER,
} from "../materials.js";
import type { Prefab } from "../prefab.js";
import type { Theme, ThemeCtx } from "./kit.js";
import {
  clear,
  faceDisc,
  lamps,
  put,
  roundFloors,
  shape,
  towerWindows,
  withIslets,
} from "./layout.js";

/** Building-block houses: primary colours, play-mat roofs. */
const HOUSES: readonly Omit<HouseSpec, "id">[] = [
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_YELLOW,
    trim: MAT_PAINT_RED,
    base: MAT_PAINT_BLUE,
    roof: "gable-x",
    roofMat: MAT_PAINT_RED,
    chimney: true,
  },
  {
    w: 22,
    d: 18,
    storeys: 3,
    wall: MAT_PAINT_BLUE,
    trim: MAT_PAINT_WHITE,
    base: MAT_PAINT_RED,
    roof: "hip",
    roofMat: MAT_PAINT_YELLOW,
    balcony: 2,
  },
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_RED,
    trim: MAT_PAINT_YELLOW,
    base: MAT_PAINT_BLUE,
    roof: "gable-z",
    roofMat: MAT_PAINT_BLUE,
    shop: true,
    sign: "sign-chandler",
  },
  {
    w: 22,
    d: 18,
    storeys: 2,
    wall: MAT_PAINT_WHITE,
    trim: MAT_PAINT_BLUE,
    base: MAT_PAINT_RED,
    roof: "flat",
    roofMat: MAT_PAINT_YELLOW,
    garden: true,
  },
];

function home(i: number, extra: Partial<HouseSpec> = {}): Prefab {
  const spec = HOUSES[i % HOUSES.length]!;
  return house({ ...spec, ...extra, id: `toybox-${i}`, windowStep: 7 } as HouseSpec);
}

/** The Block Keep: a castle of stacked toy blocks in colour courses, round striped towers. */
function blockKeep(): Prefab {
  const b = new PrefabBuilder("block-keep", 48, 70, 48);
  const cols = [MAT_PAINT_RED, MAT_PAINT_BLUE, MAT_PAINT_YELLOW, MAT_PAINT_WHITE];
  // Keep: 28 x 28, three storeys, alternating colour courses of 6-voxel blocks.
  const k0 = 10;
  const k1 = 37;
  b.footing(MAT_PAINT_WHITE, 2, 2, 45, 45);
  b.solid(MAT_PAINT_RED, k0, 0, k0, k1, 34, k1);
  for (let y = 0; y < 34; y += 6)
    for (let x = k0; x <= k1; x += 6)
      b.paint(cols[((x - k0) / 6 + y / 6) & 3]!, x, y, k0, x + 5, y + 5, k1);
  b.air(k0 + 2, 2, k0 + 2, k1 - 2, 32, k1 - 2);
  for (const y of [12, 23]) b.solid(MAT_PLANKS, k0 + 2, y, k0 + 2, k1 - 2, y, k1 - 2);
  for (let i = 0; i < 2; i++) {
    const yb = 2 + i * 11;
    const lane = k1 - 5 - i * 3;
    for (let j = 0; j <= 10; j++)
      b.solid(MAT_TIMBER, k0 + 3 + j, yb, lane, k0 + 3 + j, yb + j, lane + 2);
    b.air(k0 + 3, yb + 10, lane, k0 + 13, yb + 11, lane + 2);
  }
  // Battlements: every other 3-voxel merlon on the parapet.
  for (let x = k0; x <= k1; x += 6) {
    b.solid(MAT_PAINT_YELLOW, x, 35, k0, x + 2, 37, k0 + 1);
    b.solid(MAT_PAINT_YELLOW, x, 35, k1 - 1, x + 2, 37, k1);
    b.solid(MAT_PAINT_YELLOW, k0, 35, x, k0 + 1, 37, x + 2);
    b.solid(MAT_PAINT_YELLOW, k1 - 1, 35, x, k1, 37, x + 2);
  }
  // Gate: a round-topped arch through the front.
  b.air(21, 1, k0, 26, 9, k0 + 1);
  faceDisc(b, "air", 0, 23, 9, 3, k0, k0 + 1);
  b.anchor("door", 23, 1, k0, NZ)
    .anchor("lamp-wall", 18, 9, k0, NZ)
    .anchor("lamp-wall", 29, 9, k0, NZ);
  for (const y of [15, 26])
    for (let x = k0 + 5; x < k1 - 3; x += 8) {
      b.air(x, y, k0, x + 2, y + 4, k0 + 1).anchor("window", x + 1, y - 1, k0, NZ);
      b.air(x, y, k1 - 1, x + 2, y + 4, k1).anchor("window", x + 1, y - 1, k1, PZ);
    }
  // Corner towers: round, 7 radius, stacked rings of colour with a cone of blocks on top.
  (
    [
      [8, 8],
      [39, 8],
      [8, 39],
      [39, 39],
    ] as const
  ).forEach(([cx, cz], t) => {
    for (let y = 0; y < 48; y += 6) b.ring("solid", cols[(t + y / 6) & 3]!, cx, cz, 6, 2, y, y + 5);
    b.disc("air", 0, cx, cz, 4, 2, 47);
    roundFloors(b, MAT_PLANKS, cx, cz, 4, 12, 45);
    for (let k = 0; k < 4; k++)
      b.disc(
        "solid",
        cols[(t + k + 1) & 3]!,
        cx,
        cz,
        6 - k * 2 > 0 ? 6 - k * 2 : 0,
        48 + k * 3,
        50 + k * 3,
      );
    b.anchor("flagpole", cx, 59, cz, UP);
    towerWindows(b, cx, cz, 6, 30);
  });
  b.anchor("bunting", 23, 30, k0, NZ);
  return b.build();
}

/** The harbour on a 256 core (the islets go round it). */
function core(ctx: ThemeCtx): void {
  const box = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): number =>
    Math.min(x - x0, x1 - x, z - z0, z1 - z);
  const inside = (x: number, z: number): number =>
    Math.max(
      box(x, z, 22, 40, 116, 204),
      box(x, z, 140, 40, 234, 204),
      box(x, z, 150, 200, 166, 250),
      box(x, z, 198, 200, 214, 244),
      box(x, z, 150, 236, 214, 250),
    );
  const level = (x: number, z: number): number =>
    z > 204 ? 32 : x < 92 && z < 100 ? 46 : x > 200 && z > 140 ? 40 : 34;
  shape(ctx, inside, level, 40);
  // Keep across the channel, with a passage through its ground floor from one half to the other.
  const g = put(ctx, blockKeep(), 128, 120, 0, 4001, 35);
  clear(ctx, 104, g, 116, 152, g + 8, 122);
  // Block stairs from the low half up to the raised west tier and the east step.
  put(ctx, stairFlight(12, 5, MAT_PAINT_YELLOW), 76, 108, 3, 4002, 35);
  put(ctx, stairFlight(6, 5, MAT_PAINT_RED), 200, 130, 1, 4003, 35);
  // Stacked houses: a second (and third) house set on the roof of the first, turned and shifted.
  const stacks: [number, number, number][] = [
    [56, 70, 47],
    [56, 160, 35],
    [190, 76, 35],
    [214, 172, 41],
  ];
  stacks.forEach(([x, z, y], i) => {
    const low = home(i, { roof: "flat", storeys: 2, garden: false });
    put(ctx, low, x, z, i & 1 ? 0 : 2, 4010 + i, y);
    const hi = home(i + 1, {
      storeys: i === 2 ? 2 : 1,
      roof: i === 2 ? "flat" : "gable-x",
    });
    const y2 = y + 2 * 11 + 2;
    put(ctx, hi, x + (i & 1 ? 6 : -6), z + 3, i & 1 ? 2 : 0, 4020 + i, y2);
    if (i === 2)
      put(ctx, home(3, { storeys: 1, roof: "hip" }), x - 4, z + 6, 1, 4030, y2 + 2 * 11 + 2);
  });
  // Piers: bollards and moored boats along the arm, a crane at its head.
  for (let z = 206; z < 246; z += 6) {
    ctx.decor.push({ kind: "bollard", x: 150, y: 32, z, face: UP, v: z });
    ctx.decor.push({ kind: "moored-boat", x: 150, y: 32, z, face: NX, v: z * 7 });
    ctx.decor.push({ kind: "moored-boat", x: 214, y: 32, z: z - 2, face: PX, v: z * 3 });
  }
  put(ctx, crane(), 206, 246, 3, 4040, 33);
  // A plank footbridge over the channel's south end, so the halves also meet in the open.
  put(ctx, plankBridge(34, 7), 128, 190, 0, 4050, 32);
  lamps(ctx, [
    [100, 150],
    [100, 190],
    [160, 150],
    [160, 190],
    [130, 196],
    [158, 210],
  ]);
}

export const toyboxHarbor: Theme = {
  id: "toybox-harbor",
  name: "Toybox Harbor",
  minSize: 384,
  sizeY: 128,
  build(ctx) {
    withIslets(ctx, core, {
      house: (i) => home(i, { storeys: 1, w: 18, d: 16, balcony: 0, garden: false }),
      salt: 4900,
      maxLevel: 36,
    });
  },
};
