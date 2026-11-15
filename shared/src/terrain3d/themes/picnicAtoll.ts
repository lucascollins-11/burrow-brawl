// Picnic Atoll: a sprawling atoll. A wide, low ring of land round a lagoon, with a channel cut
// through the south side. Hamper Hall straddles the lagoon mouth as a bridge-house with the water
// running underneath, a winding boardwalk market street loops round the ring with blanket-roofed
// stalls either side, sandwich flats stand on the wide parts, and bridged islets ring it all.
import { isqrt } from "../../fixed.js";
import { NX, NZ, PX, PZ, PrefabBuilder, UP } from "../build/builder.js";
import { house, type HouseSpec } from "../build/house.js";
import { plankBridge } from "../build/pieces.js";
import {
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_PLASTER,
  MAT_ROOF_TILE,
  MAT_THATCH,
  MAT_TIMBER,
} from "../materials.js";
import { ensureMaterial, type Prefab } from "../prefab.js";
import type { Theme, ThemeCtx } from "./kit.js";
import { SEABED, clear, icos, isin, put, shape, wobble, withIslets } from "./layout.js";

/** Sandwich flats and picnic cottages: bread walls, lettuce-green roofs, cheese trims. */
const HOUSES: readonly Omit<HouseSpec, "id">[] = [
  // Sandwich flats: bread walls, lettuce-green roofs, cheese trims.
  {
    w: 22,
    d: 18,
    storeys: 3,
    wall: MAT_PLASTER,
    trim: MAT_PAINT_YELLOW,
    base: MAT_PLANKS,
    roof: "flat",
    roofMat: MAT_ROOF_TILE,
    garden: true,
    balcony: 2,
    flowerBoxes: true,
  },
  {
    w: 20,
    d: 18,
    storeys: 2,
    wall: MAT_THATCH,
    trim: MAT_PAINT_RED,
    base: MAT_PLANKS,
    roof: "gable-x",
    roofMat: MAT_PAINT_RED,
    shop: true,
    sign: "sign-cafe",
    chimney: true,
  },
  {
    w: 22,
    d: 18,
    storeys: 2,
    wall: MAT_PLASTER,
    trim: MAT_PAINT_RED,
    base: MAT_PLANKS,
    roof: "gable-z",
    roofMat: MAT_ROOF_TILE,
    frame: "timber",
    flowerBoxes: true,
  },
  {
    w: 20,
    d: 18,
    storeys: 3,
    wall: MAT_PAINT_WHITE,
    trim: MAT_PAINT_RED,
    base: MAT_PLANKS,
    roof: "hip",
    roofMat: MAT_PAINT_RED,
    balcony: 1,
  },
];

function home(i: number, extra: Partial<HouseSpec> = {}): Prefab {
  const spec = HOUSES[i % HOUSES.length]!;
  return house({ ...spec, ...extra, id: `picnic-${i}`, windowStep: 7 } as HouseSpec);
}

/** Hamper Hall: a wicker hamper the size of a town hall under a red-and-white checked cloth. */
function hamperHall(): Prefab {
  const W = 40;
  const D = 30;
  const H = 30;
  const b = new PrefabBuilder("hamper-hall", 48, 50, 48);
  const x0 = 4;
  const z0 = 9;
  const x1 = x0 + W - 1;
  const z1 = z0 + D - 1;
  b.footing(MAT_PLANKS, x0, z0, x1, z1);
  b.solid(MAT_THATCH, x0, 0, z0, x1, H, z1);
  // Weave: alternate courses of the wicker are a shade darker (timber), every third voxel.
  for (let y = 1; y < H; y += 3) b.paint(MAT_PLANKS, x0, y, z0, x1, y, z1);
  b.air(x0 + 2, 2, z0 + 2, x1 - 2, H - 2, z1 - 2);
  for (const y of [11, 22]) b.solid(MAT_PLANKS, x0 + 2, y, z0 + 2, x1 - 2, y, z1 - 2);
  // Stairs up the back wall.
  for (const [yb, lane] of [
    [1, z1 - 5],
    [12, z1 - 8],
  ] as const) {
    for (let j = 0; j <= 10; j++)
      b.solid(MAT_TIMBER, x0 + 3 + j, yb, lane, x0 + 3 + j, yb + j, lane + 2);
    b.air(x0 + 3, yb + 10, lane, x0 + 13, yb + 11, lane + 2);
  }
  // Windows on every side, a big door under a lid-flap awning.
  for (const y of [5, 16]) {
    for (let x = x0 + 5; x < x1 - 3; x += 8) {
      b.air(x, y, z0, x + 2, y + 4, z0 + 1).anchor("window", x + 1, y - 1, z0, NZ);
      b.air(x, y, z1 - 1, x + 2, y + 4, z1).anchor("window", x + 1, y - 1, z1, PZ);
    }
    for (let z = z0 + 6; z < z1 - 3; z += 9) {
      b.air(x0, y, z, x0 + 1, y + 4, z + 2).anchor("window", x0, y - 1, z + 1, NX);
      b.air(x1 - 1, y, z, x1, y + 4, z + 2).anchor("window", x1, y - 1, z + 1, PX);
    }
  }
  const mx = x0 + (W >> 1);
  b.air(mx - 3, 1, z0, mx + 3, 9, z0 + 1);
  b.anchor("door", mx, 1, z0, NZ)
    .anchor("lamp-wall", mx - 5, 8, z0, NZ)
    .anchor("lamp-wall", mx + 5, 8, z0, NZ);
  b.anchor("awning", mx, 11, z0, NZ).anchor("sign-cafe", mx + 8, 10, z0, NZ);
  // The checked cloth: a slab over the lid, hanging two voxels down every side, red and white.
  b.solid(MAT_PAINT_WHITE, x0 - 1, H + 1, z0 - 1, x1 + 1, H + 2, z1 + 1);
  b.solid(MAT_PAINT_WHITE, x0 - 1, H - 2, z0 - 1, x0 - 1, H, z1 + 1);
  b.solid(MAT_PAINT_WHITE, x1 + 1, H - 2, z0 - 1, x1 + 1, H, z1 + 1);
  b.solid(MAT_PAINT_WHITE, x0 - 1, H - 2, z0 - 1, x1 + 1, H, z0 - 1);
  b.solid(MAT_PAINT_WHITE, x0 - 1, H - 2, z1 + 1, x1 + 1, H, z1 + 1);
  for (let z = z0 - 1; z <= z1 + 1; z += 4)
    for (let x = x0 - 1 + (((z - z0 + 1) >> 2) & 1) * 4; x <= x1 + 1; x += 8)
      b.paint(MAT_PAINT_RED, x, H - 2, z, Math.min(x1 + 1, x + 3), H + 2, Math.min(z1 + 1, z + 3));
  // Handle: a wicker arch over the long side, with a rooftop terrace inside it.
  for (let i = 0; i <= 14; i++) {
    const y = H + 3 + Math.min(i, 14 - i, 5) * 2;
    b.solid(
      MAT_THATCH,
      x0 + 4 + i * 2,
      y,
      z0 + (D >> 1) - 1,
      x0 + 5 + i * 2,
      y + 2,
      z0 + (D >> 1) + 1,
    );
  }
  for (let x = x0 + 2; x <= x1 - 2; x += 3) {
    b.anchor("railing", x, H + 2, z0, UP);
    b.anchor("railing", x, H + 2, z1, UP);
  }
  b.anchor("table-set", x0 + 10, H + 2, z0 + 6, UP).anchor("table-set", x1 - 10, H + 2, z1 - 6, UP);
  b.anchor("flagpole", x1 - 2, H + 2, z0 + 2, UP);
  b.anchor("table-set", mx, 12, z0 + 10, UP).anchor("bookshelf", x0 + 3, 12, z0 + 3, UP);
  return b.build();
}

/** A market stall: four posts, a counter, and a striped blanket roof (red or blue). */
function stall(k: number): Prefab {
  const b = new PrefabBuilder("stall", 9, 10, 7);
  b.footing(MAT_PLANKS, 0, 0, 8, 6);
  for (const [x, z] of [
    [0, 0],
    [8, 0],
    [0, 6],
    [8, 6],
  ] as const)
    b.solid(MAT_TIMBER, x, 0, z, x, 6, z);
  b.solid(MAT_PLANKS, 1, 0, 0, 7, 2, 1);
  const a = k & 1 ? MAT_PAINT_RED : MAT_PAINT_BLUE;
  b.solid(MAT_PAINT_WHITE, 0, 7, 0, 8, 7, 6);
  for (let z = 0; z <= 6; z += 2)
    for (let x = (z >> 1) & 1; x <= 8; x += 2) b.paint(a, x, 7, z, x, 7, Math.min(6, z + 1));
  b.solid(MAT_PAINT_WHITE, 0, 6, 0, 8, 6, 0);
  b.anchor("counter-goods", 4, 2, 0, UP).anchor("market-sign", 4, 6, 0, NZ);
  return b.build();
}

/** The atoll on a 256 core (the islets go round it). Centre of the lagoon. */
const CX = 128;
const CZ = 124;

function core(ctx: ThemeCtx): void {
  const wob = wobble(ctx, 4501, 44, 10);
  const r = (x: number, z: number): number => isqrt((x - CX) ** 2 + (z - CZ) ** 2);
  const mouth = (x: number, z: number): boolean => z > 150 && Math.abs(x - CX) < 12;
  const inside = (x: number, z: number): number => {
    const d = r(x, z) + wob(x, z);
    const ring = Math.min(d - 48, 116 - d);
    return mouth(x, z) ? Math.min(ring, Math.abs(x - CX) - 12) : ring;
  };
  shape(ctx, inside, () => 33, 2);
  // Hamper Hall over the mouth, the water running under it.
  const g = put(ctx, hamperHall(), CX, CZ + 84, 0, 4501, 34);
  clear(ctx, CX - 11, SEABED, CZ + 84 - 14, CX + 11, g - 2, CZ + 84 + 14);
  // A plank footbridge across the mouth on the lagoon side, so the ring is walkable all round.
  put(ctx, plankBridge(38, 7), CX, CZ + 63, 0, 4502, 31);
  // The winding street: a boardwalk weaving in and out round the ring (a turn is 256 steps),
  // with stalls on alternate sides.
  const mat = ensureMaterial(ctx.t);
  let k = 0;
  for (let step = 0; step <= 228; step++) {
    const turn = 78 + step; // from just east of the mouth, round, to just west of it
    const rm = 82 + ((isin(turn * 3) * 12) >> 10);
    const x = CX + ((icos(turn) * rm) >> 10);
    const z = CZ + ((isin(turn) * rm) >> 10);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const y = ctx.surf(x + dx, z + dz);
        if (y > ctx.t.seaY) mat[(y * ctx.d + z + dz) * ctx.w + x + dx] = MAT_PLANKS;
      }
    if (step % 11 === 5) {
      const side = k & 1 ? 9 : -9;
      const sx = CX + ((icos(turn) * (rm + side)) >> 10);
      const sz = CZ + ((isin(turn) * (rm + side)) >> 10);
      // Face the street: the stall's front (-z) turns toward the path.
      const ox = x - sx;
      const oz = z - sz;
      const rot = Math.abs(ox) > Math.abs(oz) ? (ox > 0 ? 1 : 3) : oz > 0 ? 2 : 0;
      if (ctx.surf(sx, sz) > ctx.t.seaY) put(ctx, stall(k), sx, sz, rot, 4510 + k, 34);
      k++;
    }
  }
  // Sandwich flats on the wide parts of the ring.
  const spots: [number, number, number][] = [
    [CX - 96, CZ, 1],
    [CX + 96, CZ, 3],
    [CX, CZ - 96, 0],
  ];
  spots.forEach(([x, z, rot], i) => put(ctx, home(i), x, z, rot, 4530 + i, 34));
}

export const picnicAtoll: Theme = {
  id: "picnic-atoll",
  name: "Picnic Atoll",
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
