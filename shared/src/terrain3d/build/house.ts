// A parametric house prefab: storeys with real floors and switchback stairs, doors, windows with
// trims, a roof (gable, hip or flat with a parapet and roof garden), chimney, balcony, shopfront
// and furniture. Every option comes from HouseSpec, so a theme can make no two houses alike.
//
// Local layout: the body occupies x in [M, M + w), z in [M, M + d) where M = MARGIN, leaving room
// for roof overhangs, balconies and front steps. The front (door) faces -z. y = 0 is the first
// voxel above the ground: the ground floor slab is y 0..1, so you walk in up two front steps.

import {
  MAT_BRICK,
  MAT_COBBLE,
  MAT_GLASS,
  MAT_METAL,
  MAT_PAINT_WHITE,
  MAT_PLANKS,
  MAT_SLATE,
  MAT_STONE,
  MAT_TIMBER,
} from "../materials.js";
import type { Prefab } from "../prefab.js";
import { NX, NZ, PrefabBuilder, PX, PZ, UP } from "./builder.js";

export const STOREY = 11;
export const MARGIN = 3;

export type RoofKind = "gable-x" | "gable-z" | "hip" | "flat";

export interface HouseSpec {
  readonly id: string;
  /** Body size in voxels (x, z). At least 18 x 16 so stairs fit. */
  readonly w: number;
  readonly d: number;
  readonly storeys: number;
  readonly wall: number;
  readonly trim: number;
  /** Plinth and foundation. */
  readonly base: number;
  readonly roof: RoofKind;
  readonly roofMat: number;
  /** Wall decoration: timber frame, stone corner quoins, or none. */
  readonly frame?: "timber" | "quoins" | "none";
  readonly chimney?: boolean;
  /** Storey (1-based upper floor) that gets a front balcony; 0 = none. */
  readonly balcony?: number;
  /** Ground floor is a shop: a wide window, a counter, shelves, an awning and a sign. */
  readonly shop?: boolean;
  /** Flat roofs: planters, a bench and washing lines. */
  readonly garden?: boolean;
  /** Window spacing along a wall (6..9). */
  readonly windowStep?: number;
  /** Detail kinds hung on the walls: flower boxes under windows, nets, lamps. */
  readonly flowerBoxes?: boolean;
  readonly nets?: boolean;
  readonly sign?: string;
}

export function houseSize(s: HouseSpec): [sx: number, sz: number] {
  return [s.w + 2 * MARGIN, s.d + 2 * MARGIN];
}

export function house(s: HouseSpec): Prefab {
  if (s.w < 18 || s.d < 16 || s.storeys < 1)
    throw new RangeError(`house ${s.id}: too small (${s.w} x ${s.d}, ${s.storeys} storeys)`);
  const M = MARGIN;
  const { w, d } = s;
  const x0 = M;
  const z0 = M;
  const x1 = M + w - 1;
  const z1 = M + d - 1;
  const top = s.storeys * STOREY + 1; // highest wall voxel (the roof deck)
  const roofLayers = s.roof === "flat" ? 4 : (Math.min(w, d) + 3) >> 1;
  const sy = top + 1 + roofLayers + 6;
  const b = new PrefabBuilder(s.id, w + 2 * M, sy, d + 2 * M);
  const mx = x0 + (w >> 1);

  // Shell and foundation.
  b.footing(s.base, x0, z0, x1, z1);
  b.solid(s.wall, x0, 0, z0, x1, top, z1);
  b.paint(s.base, x0, 0, z0, x1, 2, z1);
  for (let k = 0; k < s.storeys; k++)
    b.air(x0 + 2, k * STOREY + 2, z0 + 2, x1 - 2, k * STOREY + 10, z1 - 2);

  // Wall decoration (paint before cutting openings, so openings stay clean).
  const frame = s.frame ?? "none";
  for (let k = 0; k <= s.storeys; k++) {
    // A trim band at every floor line: the slab shows on the outside as a cornice.
    b.paint(frame === "timber" ? MAT_TIMBER : s.trim, x0, k * STOREY, z0, x1, k * STOREY + 1, z1);
  }
  if (frame === "timber") {
    // Corner posts, posts between window bays, diagonal braces on the front and back.
    for (const [px0, px1] of [
      [x0, x0 + 1],
      [x1 - 1, x1],
    ] as const)
      b.paint(MAT_TIMBER, px0, 0, z0, px1, top, z1);
    b.paint(MAT_TIMBER, x0, 0, z0, x1, top, z0 + 1);
    b.paint(s.wall, x0 + 2, 2, z0, x1 - 2, top - 2, z0 + 1);
    b.paint(s.wall, x0 + 2, 2, z1 - 1, x1 - 2, top - 2, z1);
    const step = s.windowStep ?? 7;
    for (let x = x0 + 1 + step; x < x1 - 2; x += step) {
      b.paint(MAT_TIMBER, x, 0, z0, x, top, z0 + 1);
      b.paint(MAT_TIMBER, x, 0, z1 - 1, x, top, z1);
    }
    for (let k = 0; k < s.storeys; k++) {
      const yb = k * STOREY + 2;
      for (let i = 0; i < 4; i++) {
        b.paint(MAT_TIMBER, x0 + 2 + i, yb + i, z0, x0 + 2 + i, yb + i, z0 + 1);
        b.paint(MAT_TIMBER, x1 - 2 - i, yb + i, z0, x1 - 2 - i, yb + i, z0 + 1);
        b.paint(MAT_TIMBER, x0 + 2 + i, yb + i, z1 - 1, x0 + 2 + i, yb + i, z1);
        b.paint(MAT_TIMBER, x1 - 2 - i, yb + i, z1 - 1, x1 - 2 - i, yb + i, z1);
      }
    }
  } else if (frame === "quoins") {
    for (let y = 2; y < top - 1; y += 4)
      for (const [cx, cz] of [
        [x0, z0],
        [x1 - 1, z0],
        [x0, z1 - 1],
        [x1 - 1, z1 - 1],
      ] as const)
        b.paint(MAT_STONE, cx, y, cz, cx + 1, y + 1, cz + 1);
  }

  // Inside: switchback stairs in two lanes along the back wall, one flight per storey, and up to
  // the roof hatch when the roof is flat.
  const flights = s.roof === "flat" ? s.storeys : s.storeys - 1;
  for (let k = 0; k < flights; k++) {
    const lane = k & 1 ? z1 - 7 : z1 - 4; // inclusive z..z+2
    const yb = k * STOREY + 2; // floor surface voxel of storey k
    for (let j = 0; j <= 10; j++)
      b.solid(MAT_TIMBER, x0 + 2 + j, yb, lane, x0 + 2 + j, yb + j, lane + 2);
    // Opening in the floor above, over the flight.
    b.air(x0 + 2, (k + 1) * STOREY, lane, x0 + 12, (k + 1) * STOREY + 1, lane + 2);
    if (k + 1 === s.storeys) {
      // Roof hatch: a small timber kiosk keeps the hole from being a sheer drop from outside.
      b.solid(MAT_TIMBER, x0 + 1, top + 1, lane - 1, x0 + 13, top + 2, lane - 1);
      b.anchor("hatch", x0 + 13, top, lane + 1, UP);
    }
  }

  // Doors and front steps.
  b.paint(s.trim, mx - 3, 2, z0, mx + 3, 10, z0 + 1);
  b.air(mx - 2, 2, z0, mx + 2, 9, z0 + 1);
  b.solid(MAT_STONE, mx - 3, 0, z0 - 2, mx + 3, 0, z0 - 1);
  b.solid(MAT_STONE, mx - 3, 1, z0 - 1, mx + 3, 1, z0 - 1);
  b.footing(MAT_STONE, mx - 3, z0 - 2, mx + 3, z0 - 1);
  b.anchor("door", mx, 1, z0, NZ);
  b.anchor("lamp-wall", mx + 4, 8, z0, NZ);
  // A back door too, so a house is never a dead end.
  b.air(mx - 2, 2, z1 - 1, mx + 2, 9, z1);
  b.anchor("door", mx, 1, z1, PZ);

  // Shopfront: a wide display window on the ground floor, an awning, a sign.
  if (s.shop) {
    const ws = x0 + 3;
    const we = mx - 5;
    if (we - ws >= 4) {
      b.paint(s.trim, ws - 1, 3, z0, we + 1, 9, z0 + 1);
      b.air(ws, 4, z0, we, 8, z0 + 1);
      b.anchor("shop-window", (ws + we) >> 1, 3, z0, NZ);
    }
    b.anchor("awning", mx, 10, z0, NZ);
    b.anchor(s.sign ?? "sign", mx + 6, 10, z0, NZ);
    // Counter and shelves inside.
    b.solid(MAT_TIMBER, x0 + 4, 2, z0 + 7, x1 - 4, 4, z0 + 8);
    b.anchor("counter-goods", mx, 4, z0 + 7, UP);
    b.solid(MAT_TIMBER, x1 - 3, 2, z0 + 3, x1 - 2, 8, z0 + 8);
    b.anchor("shelf-goods", x1 - 3, 5, z0 + 5, NX);
  }

  // Windows on every wall and storey, with trims, sills and (sometimes) flower boxes.
  const step = s.windowStep ?? 7;
  const winRow = (k: number, along: "x" | "z", fixed: number, face: number) => {
    const lo = (along === "x" ? x0 : z0) + 3;
    const hi = (along === "x" ? x1 : z1) - 5;
    const y = k * STOREY + 5;
    let i = 0;
    for (let a = lo; a <= hi; a += step, i++) {
      if (k === 0 && face === NZ && (Math.abs(a + 1 - mx) < 6 || (s.shop && a < mx))) continue;
      if (k === 0 && face === PZ && Math.abs(a + 1 - mx) < 6) continue;
      const out = face === NZ ? fixed : face === PZ ? fixed + 1 : face === NX ? fixed : fixed + 1;
      const inn = face === NZ ? fixed + 1 : face === PZ ? fixed : face === NX ? fixed + 1 : fixed;
      if (along === "x") {
        b.paint(s.trim, a - 1, y - 1, Math.min(out, inn), a + 3, y + 4, Math.max(out, inn));
        b.air(a, y, Math.min(out, inn), a + 2, y + 3, Math.max(out, inn));
        b.anchor("window", a + 1, y - 1, out, face);
        if (s.flowerBoxes && (i & 1) === 0) b.anchor("flowerbox", a + 1, y - 1, out, face);
      } else {
        b.paint(s.trim, Math.min(out, inn), y - 1, a - 1, Math.max(out, inn), y + 4, a + 3);
        b.air(Math.min(out, inn), y, a, Math.max(out, inn), y + 3, a + 2);
        b.anchor("window", out, y - 1, a + 1, face);
        if (s.flowerBoxes && (i & 1) === 1) b.anchor("flowerbox", out, y - 1, a + 1, face);
      }
    }
  };
  for (let k = 0; k < s.storeys; k++) {
    winRow(k, "x", z0, NZ);
    winRow(k, "x", z1 - 1, PZ);
    winRow(k, "z", x0, NX);
    winRow(k, "z", x1 - 1, PX);
  }

  // Balcony on an upper storey: a plank deck out front, a door onto it, railings.
  const bal = s.balcony ?? 0;
  if (bal >= 1 && bal < s.storeys) {
    const yb = bal * STOREY;
    b.solid(MAT_PLANKS, mx - 5, yb, z0 - 3, mx + 5, yb + 1, z0 - 1);
    b.air(mx - 2, yb + 2, z0, mx + 2, yb + 9, z0 + 1);
    for (let x = mx - 5; x <= mx + 5; x += 2) b.anchor("railing", x, yb + 1, z0 - 3, UP);
    b.anchor("railing", mx - 5, yb + 1, z0 - 2, UP);
    b.anchor("railing", mx + 5, yb + 1, z0 - 2, UP);
    b.anchor("planter", mx + 4, yb + 1, z0 - 2, UP);
  }

  // Furniture: a table and hearth downstairs, beds and wardrobes upstairs, rugs everywhere.
  for (let k = 0; k < s.storeys; k++) {
    const yb = k * STOREY + 2;
    const tx = x1 - 9;
    const tz = z0 + 4;
    if (!(k === 0 && s.shop)) {
      if (k === 0) {
        b.solid(MAT_TIMBER, tx, yb, tz, tx, yb + 2, tz);
        b.solid(MAT_TIMBER, tx + 4, yb, tz, tx + 4, yb + 2, tz);
        b.solid(MAT_TIMBER, tx, yb, tz + 3, tx, yb + 2, tz + 3);
        b.solid(MAT_TIMBER, tx + 4, yb, tz + 3, tx + 4, yb + 2, tz + 3);
        b.solid(MAT_TIMBER, tx, yb + 3, tz, tx + 4, yb + 3, tz + 3);
        b.anchor("table-set", tx + 2, yb + 3, tz + 1, UP);
        // Hearth on the side wall.
        b.solid(MAT_BRICK, x1 - 3, yb, z0 + 9, x1 - 2, yb + 5, z0 + 13);
        b.air(x1 - 3, yb, z0 + 10, x1 - 3, yb + 2, z0 + 12);
        b.anchor("hearth", x1 - 3, yb, z0 + 11, NX);
      } else {
        b.solid(MAT_TIMBER, tx - 2, yb, tz, tx + 4, yb + 1, tz + 3);
        b.anchor("bed", tx + 1, yb + 1, tz + 1, UP);
        b.solid(MAT_TIMBER, x1 - 3, yb, z0 + 9, x1 - 2, yb + 6, z0 + 11);
        b.anchor("wardrobe", x1 - 3, yb + 3, z0 + 10, NX);
      }
    }
    b.anchor("rug", x0 + 6, yb - 1, z0 + 5, UP);
    b.anchor("ceiling-lamp", x0 + 8, k * STOREY + 11, z0 + 6, 5);
  }

  // Roof.
  const ry = top + 1;
  let roofTop = ry;
  if (s.roof === "flat") {
    b.solid(s.trim, x0, ry, z0, x1, ry + 1, z0);
    b.solid(s.trim, x0, ry, z1, x1, ry + 1, z1);
    b.solid(s.trim, x0, ry, z0, x0, ry + 1, z1);
    b.solid(s.trim, x1, ry, z0, x1, ry + 1, z1);
    b.air(x0, ry + 1, mx - 2, x0, ry + 1, mx + 2); // drain gaps double as climb spots
    for (let x = x0 + 2; x <= x1 - 2; x += 4) b.anchor("parapet-cap", x, ry + 1, z0, UP);
    if (s.garden) {
      b.solid(MAT_TIMBER, x1 - 6, ry, z0 + 2, x1 - 2, ry + 1, z0 + 4);
      b.anchor("planter-veg", x1 - 4, ry + 1, z0 + 3, UP);
      b.solid(MAT_TIMBER, x0 + 2, ry, z0 + 2, x0 + 4, ry + 1, z0 + 6);
      b.anchor("planter-flowers", x0 + 3, ry + 1, z0 + 4, UP);
      b.anchor("bench", mx, top, z0 + 3, UP);
      b.anchor("washing-line", x0 + 2, ry + 1, z0 + 9, PX);
      b.anchor("potted-tree", x1 - 3, top, z1 - 3, UP);
    }
    roofTop = ry + 1;
  } else {
    // Stepped layers, each one voxel up and one voxel in: walkable, and a gun-step to climb.
    const hip = s.roof === "hip";
    const alongX = s.roof === "gable-x" || (hip && w >= d);
    let i = 0;
    for (; ; i++) {
      const ax0 = alongX && !hip ? x0 - 1 : x0 - 1 + i;
      const ax1 = alongX && !hip ? x1 + 1 : x1 + 1 - i;
      const az0 = !alongX && !hip ? z0 - 1 : z0 - 1 + i;
      const az1 = !alongX && !hip ? z1 + 1 : z1 + 1 - i;
      // For a gable along x the slope runs across z (and the reverse).
      const sx0 = alongX ? ax0 : x0 - 1 + i;
      const sx1 = alongX ? ax1 : x1 + 1 - i;
      const sz0 = alongX ? z0 - 1 + i : az0;
      const sz1 = alongX ? z1 + 1 - i : az1;
      if (sx0 > sx1 || sz0 > sz1) break;
      b.solid(s.roofMat, sx0, ry + i, sz0, sx1, ry + i, sz1);
      // Hollow attic: keep a 2-voxel roof skin, open inside.
      if (sx1 - sx0 > 6 && sz1 - sz0 > 6) b.air(sx0 + 3, ry + i, sz0 + 3, sx1 - 3, ry + i, sz1 - 3);
      if (!hip) {
        // Gable end walls fill the triangle under the roof at both ends.
        if (alongX) {
          b.solid(s.wall, x0, ry + i, sz0 + 1, x0 + 1, ry + i, sz1 - 1);
          b.solid(s.wall, x1 - 1, ry + i, sz0 + 1, x1, ry + i, sz1 - 1);
        } else {
          b.solid(s.wall, sx0 + 1, ry + i, z0, sx1 - 1, ry + i, z0 + 1);
          b.solid(s.wall, sx0 + 1, ry + i, z1 - 1, sx1 - 1, ry + i, z1);
        }
      }
    }
    roofTop = ry + i - 1;
    // Ridge cap and eaves trims.
    b.paint(MAT_SLATE, x0 - 1, roofTop, z0 - 1, x1 + 1, roofTop, z1 + 1);
    if (!hip) {
      const mid = ry + ((roofTop - ry) >> 1);
      // An attic window in each gable end.
      if (alongX) {
        const mz = z0 + (d >> 1);
        b.air(x0, mid - 1, mz - 1, x0 + 1, mid + 1, mz + 1);
        b.air(x1 - 1, mid - 1, mz - 1, x1, mid + 1, mz + 1);
        b.anchor("attic-window", x0, mid - 2, mz, NX);
        b.anchor("attic-window", x1, mid - 2, mz, PX);
      } else {
        b.air(mx - 1, mid - 1, z0, mx + 1, mid + 1, z0 + 1);
        b.air(mx - 1, mid - 1, z1 - 1, mx + 1, mid + 1, z1);
        b.anchor("attic-window", mx, mid - 2, z0, NZ);
        b.anchor("attic-window", mx, mid - 2, z1, PZ);
      }
    }
    b.anchor("weathervane", alongX ? x0 + 2 : mx, roofTop, alongX ? z0 + (d >> 1) : z0 + 2, UP);
    // Gutters along the eaves.
    b.anchor("gutter", mx, ry, z0 - 1, NZ);
    b.anchor("gutter", mx, ry, z1 + 1, PZ);
  }

  // Chimney: brick stack from the hearth wall up past the roof, with a pot.
  if (s.chimney) {
    const cx = x1 - 3;
    const cz = z0 + 10;
    b.solid(MAT_BRICK, cx, top - 1, cz, cx + 2, roofTop + 3, cz + 2);
    b.paint(MAT_STONE, cx, roofTop + 3, cz, cx + 2, roofTop + 3, cz + 2);
    b.anchor("chimney-pot", cx + 1, roofTop + 3, cz + 1, UP);
  }

  // Outside dressing.
  if (s.nets) {
    b.anchor("net-hung", x0, 6, z0 + 4, NX);
    b.anchor("lobster-pots", x1 + 1, -1, z0 + 3, UP);
  }
  b.anchor("downpipe", x0, top, z0, NZ);
  b.anchor("downpipe", x1, top, z1, PZ);
  b.anchor("house-number", mx - 4, 8, z0, NZ);
  return b.build();
}

/** Glass and metal accents are available to callers that build lanterns and shopfronts. */
export const ACCENTS = {
  glass: MAT_GLASS,
  metal: MAT_METAL,
  white: MAT_PAINT_WHITE,
  cobble: MAT_COBBLE,
};
