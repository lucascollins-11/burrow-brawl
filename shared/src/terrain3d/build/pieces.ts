// Set-piece prefabs: lighthouse, ferry, pier, fish market, crane, boatyard hull, slipway, stairs,
// bridges, well, beach hut. All integer, all parametric. Local conventions as in house.ts:
// y = 0 is the first voxel above the ground the piece stands on.

import {
  MAT_BRICK,
  MAT_COBBLE,
  MAT_GLASS,
  MAT_METAL,
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_WHITE,
  MAT_PAINT_YELLOW,
  MAT_PLANKS,
  MAT_PLASTER,
  MAT_SLATE,
  MAT_STONE,
  MAT_TIMBER,
} from "../materials.js";
import type { Prefab } from "../prefab.js";
import { DOWN, NX, NZ, PrefabBuilder, PX, PZ, UP } from "./builder.js";

/** Stepped roof over a rectangle: one voxel up and in per layer, ridge along x or z, or hipped. */
export function steppedRoof(
  b: PrefabBuilder,
  mat: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  ridge: "x" | "z" | "hip",
  hollow = true,
): number {
  let i = 0;
  for (; ; i++) {
    const ax0 = ridge === "x" ? x0 : x0 + i;
    const ax1 = ridge === "x" ? x1 : x1 - i;
    const az0 = ridge === "z" ? z0 : z0 + i;
    const az1 = ridge === "z" ? z1 : z1 - i;
    if (ax0 > ax1 || az0 > az1) break;
    b.solid(mat, ax0, y + i, az0, ax1, y + i, az1);
    if (hollow && ax1 - ax0 > 6 && az1 - az0 > 6)
      b.air(ax0 + 3, y + i, az0 + 3, ax1 - 3, y + i, az1 - 3);
  }
  b.paint(MAT_SLATE, x0, y + i - 1, z0, x1, y + i - 1, z1);
  return y + i - 1;
}

// ------------------------------------------------------------------------------------ lighthouse

/**
 * A climbable lighthouse: five furnished storeys with switchback stairs, red and white bands, an
 * outer gallery with a rail, a glazed lantern room with the lens, a red cap and a weathervane.
 */
export function lighthouse(): Prefab {
  const R = 11;
  const c = 16; // centre, leaving room for the gallery
  const levels = 5;
  const deck = levels * 12; // gallery deck slab y deck..deck+1
  const b = new PrefabBuilder("lighthouse", 33, deck + 32, 33);
  // Plinth and tower.
  b.disc("solid", MAT_STONE, c, c, R + 3, 0, 2);
  b.footing(MAT_STONE, c - R - 3, c - R - 3, c + R + 3, c + R + 3);
  b.disc("solid", MAT_PAINT_WHITE, c, c, R, 3, deck + 1);
  for (let k = 0; k < levels; k++) b.disc("air", 0, c, c, R - 2, 12 * k + 2, 12 * k + 11);
  b.disc("air", 0, c, c, R - 2, 3, 11);
  // Red bands on the outside (paint the ring only, so floors stay plain).
  for (let y = 8; y < deck; y += 16) b.ring("paint", MAT_PAINT_RED, c, c, R, 2, y, y + 7);
  b.ring("paint", MAT_STONE, c, c, R, 2, 3, 5);
  // Switchback stairs, one flight per storey, with an opening in the floor above.
  for (let k = 0; k < levels; k++) {
    const lane = k & 1 ? c - 6 : c + 4;
    const yb = 12 * k + 2;
    const dir = k & 1 ? -1 : 1;
    for (let j = 0; j <= 11; j++) {
      const x = c + dir * (j - 6);
      b.solid(MAT_TIMBER, x, yb, lane, x, yb + j, lane + 2);
    }
    const xa = c - 6 * dir;
    const xb = c + 5 * dir;
    b.air(Math.min(xa, xb), 12 * (k + 1), lane, Math.max(xa, xb), 12 * (k + 1) + 1, lane + 2);
    b.anchor("stair-rail", c, yb + 6, lane + (k & 1 ? 2 : 0), k & 1 ? PZ : NZ);
  }
  // Door on -z, windows on +x and -x on every storey, portholes on +z.
  b.air(c - 2, 3, c - R, c + 2, 10, c - R + 2);
  b.anchor("door", c, 2, c - R, NZ);
  b.anchor("lamp-wall", c + 4, 9, c - R + 1, NZ);
  b.anchor("plaque", c - 4, 7, c - R + 1, NZ);
  for (let k = 0; k < levels; k++) {
    const y = 12 * k + 5;
    b.air(c + R - 1, y, c - 1, c + R, y + 3, c + 1);
    b.air(c - R, y, c - 1, c - R + 1, y + 3, c + 1);
    b.anchor("window-arched", c + R, y - 1, c, PX);
    b.anchor("window-arched", c - R, y - 1, c, NX);
    if (k > 0) {
      b.air(c - 1, y + 1, c + R - 1, c + 1, y + 2, c + R);
      b.anchor("porthole", c, y, c + R, PZ);
    }
  }
  // Furnishings, by storey.
  const furn = [
    ["oil-barrels", "workbench", "coil-rope"],
    ["bed", "sea-chest", "stove"],
    ["chart-table", "bookshelf", "telescope"],
    ["bunk", "radio-set", "kettle-stove"],
    ["clockwork", "spare-lens", "fog-horn-pump"],
  ];
  for (let k = 0; k < levels; k++) {
    const yb = 12 * k + 1;
    const f = furn[k]!;
    b.solid(MAT_TIMBER, c + 3, yb + 1, c - 7, c + 7, yb + 2, c - 5);
    b.anchor(f[0]!, c + 5, yb + 2, c - 6, UP);
    b.anchor(f[1]!, c - 7, yb, c - 2, UP);
    b.anchor(f[2]!, c - 3, yb, c - 6, UP);
    b.anchor("rug", c, yb, c, UP);
    b.anchor("ceiling-lamp", c, 12 * k + 11, c - 2, DOWN);
  }
  // Gallery deck, wider than the tower, with a rail all round.
  b.disc("solid", MAT_METAL, c, c, R + 4, deck, deck + 1);
  b.air(c - 6, deck, c + 4, c + 5, deck + 1, c + 6); // top flight's opening
  b.disc("air", 0, c, c, R + 4, deck + 2, deck + 31);
  for (const [dx, dz] of PrefabBuilder.rim(R + 4))
    if (((dx + dz) & 1) === 0) b.anchor("gallery-rail", c + dx, deck + 1, c + dz, UP);
  b.anchor("bell", c + R + 2, deck + 1, c, UP);
  // Lantern room: glass ring on a metal sill, a door out to the gallery, the lens in the middle.
  b.ring("solid", MAT_METAL, c, c, 7, 1, deck + 2, deck + 3);
  b.ring("solid", MAT_GLASS, c, c, 7, 1, deck + 4, deck + 11);
  for (const [dx, dz] of [
    [7, 0],
    [-7, 0],
    [0, 7],
    [0, -7],
    [5, 5],
    [-5, 5],
    [5, -5],
    [-5, -5],
  ] as const)
    b.solid(MAT_METAL, c + dx, deck + 4, c + dz, c + dx, deck + 11, c + dz);
  b.air(c - 1, deck + 2, c - 7, c + 1, deck + 8, c - 7);
  b.disc("solid", MAT_METAL, c, c, 2, deck + 2, deck + 4);
  b.anchor("lens", c, deck + 4, c, UP);
  // Cap: a stepped red dome, a ball and a vane.
  b.disc("solid", MAT_METAL, c, c, 8, deck + 12, deck + 12);
  for (let i = 0; i < 7; i++)
    b.disc("solid", MAT_PAINT_RED, c, c, 7 - i, deck + 13 + i, deck + 13 + i);
  b.anchor("weathervane", c, deck + 19, c, UP);
  b.anchor("lightning-rod", c + 1, deck + 19, c, UP);
  return b.build();
}

// ---------------------------------------------------------------------------------- harbour bits

/** A plank pier along +z on timber posts down to the seabed, with rails, lamps and bollards. */
export function pier(len: number, width: number, id = "pier"): Prefab {
  const b = new PrefabBuilder(id, width, 4, len);
  b.solid(MAT_PLANKS, 0, 0, 0, width - 1, 1, len - 1);
  b.paint(MAT_TIMBER, 0, 0, 0, 0, 1, len - 1);
  b.paint(MAT_TIMBER, width - 1, 0, 0, width - 1, 1, len - 1);
  for (let z = 1; z < len; z += 8) {
    b.footing(MAT_TIMBER, 0, z, 1, z + 1);
    b.footing(MAT_TIMBER, width - 2, z, width - 1, z + 1);
    b.footing(MAT_TIMBER, width >> 1, z + 3, (width >> 1) + 1, z + 4);
  }
  for (let z = 2; z < len - 1; z += 3) {
    b.anchor("rope-rail", 0, 1, z, UP);
    b.anchor("rope-rail", width - 1, 1, z, UP);
  }
  for (let z = 6; z < len; z += 16) {
    b.anchor("lamp-post", 1, 1, z, UP);
    b.anchor("bollard", width - 2, 1, z + 4, UP);
    b.anchor("moored-boat", width - 1, 0, z + 6, PX);
  }
  for (let z = 10; z < len; z += 22) {
    b.anchor("lifebuoy", width - 1, 1, z, PX);
    b.anchor("crates", 2, 1, z + 2, UP);
    b.anchor("lobster-pots", width - 3, 1, z + 9, UP);
  }
  b.anchor("gull-perch", 0, 1, len - 1, UP);
  return b.build();
}

/** A two-deck ferry, bow toward -z: hull with a hold, cabin with windows, wheelhouse, funnel. */
export function ferry(): Prefab {
  const L = 88;
  const W = 25;
  const cx = W >> 1;
  const b = new PrefabBuilder("ferry", W, 42, L);
  const halfAt = (z: number, y: number): number => {
    let h = 11;
    if (z < 22) h = 2 + Math.floor((z * 9) / 22);
    if (z > L - 5) h = 11 - (z - (L - 5)) * 2;
    h -= (10 - y) >> 2; // the hull narrows toward the keel
    return Math.max(0, h);
  };
  for (let y = 0; y <= 11; y++)
    for (let z = 0; z < L; z++) {
      const h = halfAt(z, Math.min(y, 10));
      if (h <= 0 && y < 4) continue;
      b.solid(
        y <= 5 ? MAT_PAINT_RED : y <= 7 ? MAT_PAINT_WHITE : MAT_PAINT_BLUE,
        cx - h,
        y,
        z,
        cx + h,
        y,
        z,
      );
    }
  // Hold inside the hull.
  for (let z = 26; z < L - 8; z++) {
    const h = halfAt(z, 3) - 2;
    if (h > 1) b.air(cx - h, 3, z, cx + h, 9, z);
  }
  // Main deck planks (and a hatch down to the hold), bulwark rails.
  for (let z = 0; z < L; z++) {
    const h = halfAt(z, 10);
    if (h > 1) b.paint(MAT_PLANKS, cx - h + 1, 10, z, cx + h - 1, 11, z);
  }
  b.air(cx - 2, 10, 70, cx + 2, 11, 74);
  b.anchor("hatch-ladder", cx, 2, 72, UP);
  b.anchor("cargo-nets", cx + 4, 2, 60, UP);
  b.anchor("barrels", cx - 5, 2, 40, UP);
  for (let z = 4; z < L - 2; z += 3) {
    const h = halfAt(z, 10);
    b.anchor("ferry-rail", cx - h, 11, z, UP);
    b.anchor("ferry-rail", cx + h, 11, z, UP);
  }
  b.anchor("ship-anchor", cx - 6, 8, 18, NX);
  b.anchor("bow-flag", cx, 11, 1, UP);
  b.anchor("stern-flag", cx, 11, L - 2, UP);
  b.anchor("name-board", cx + 11, 8, 50, PX);
  b.anchor("name-board", cx - 11, 8, 50, NX);
  // Cabin on the main deck: white walls, windows both sides, doors at both ends.
  const c0 = 24;
  const c1 = 64;
  b.solid(MAT_PAINT_WHITE, cx - 8, 12, c0, cx + 8, 21, c1);
  b.air(cx - 6, 12, c0 + 2, cx + 6, 21, c1 - 2);
  b.air(cx - 2, 12, c0, cx + 2, 19, c0 + 1);
  b.air(cx - 2, 12, c1 - 1, cx + 2, 19, c1);
  for (let z = c0 + 4; z < c1 - 4; z += 5) {
    b.air(cx - 8, 15, z, cx - 7, 18, z + 2);
    b.air(cx + 7, 15, z, cx + 8, 18, z + 2);
    b.anchor("window-round", cx - 8, 14, z + 1, NX);
    b.anchor("window-round", cx + 8, 14, z + 1, PX);
  }
  for (let z = c0 + 6; z < c1 - 4; z += 8) {
    b.solid(MAT_TIMBER, cx - 6, 12, z, cx - 4, 13, z + 3);
    b.solid(MAT_TIMBER, cx + 4, 12, z, cx + 6, 13, z + 3);
    b.anchor("bench-seat", cx - 5, 13, z + 1, UP);
    b.anchor("bench-seat", cx + 5, 13, z + 1, UP);
  }
  b.anchor("snack-counter", cx, 11, c1 - 6, UP);
  // Upper deck on the cabin roof, rails, lifeboats, wheelhouse and funnel.
  b.solid(MAT_PLANKS, cx - 9, 22, c0 - 2, cx + 9, 23, c1 + 1);
  for (let z = c0 - 2; z <= c1 + 1; z += 3) {
    b.anchor("ferry-rail", cx - 9, 23, z, UP);
    b.anchor("ferry-rail", cx + 9, 23, z, UP);
  }
  b.anchor("lifeboat", cx - 9, 23, c0 + 14, NX);
  b.anchor("lifeboat", cx + 9, 23, c0 + 14, PX);
  b.anchor("deck-chairs", cx - 4, 23, c1 - 6, UP);
  b.solid(MAT_PAINT_WHITE, cx - 5, 24, c0, cx + 5, 31, c0 + 11);
  b.air(cx - 3, 24, c0 + 2, cx + 3, 30, c0 + 9);
  b.solid(MAT_GLASS, cx - 5, 28, c0, cx + 5, 30, c0);
  b.air(cx - 1, 24, c0 + 11, cx + 1, 29, c0 + 11);
  b.solid(MAT_PAINT_RED, cx - 6, 32, c0 - 1, cx + 6, 32, c0 + 12);
  b.anchor("ships-wheel", cx, 24, c0 + 4, UP);
  b.anchor("radar-mast", cx, 32, c0 + 6, UP);
  b.anchor("horn", cx + 4, 32, c0 + 2, UP);
  b.disc("solid", MAT_PAINT_RED, cx, c0 + 26, 3, 24, 37);
  b.disc("paint", MAT_SLATE, cx, c0 + 26, 3, 35, 37);
  b.disc("air", 0, cx, c0 + 26, 1, 30, 37);
  b.anchor("funnel-smoke", cx, 37, c0 + 26, UP);
  // Stern stairs from the main deck up to the upper deck.
  for (let j = 0; j <= 11; j++)
    b.solid(MAT_PLANKS, cx - 1, 12, c1 + 12 - j, cx + 1, 12 + j, c1 + 12 - j);
  b.air(cx - 1, 22, c1 + 1, cx + 1, 23, c1 + 1);
  return b.build();
}

/** Open fish market hall: cobble floor, stone pillars, timber beams, slate roof, stalls. */
export function fishMarket(w: number, d: number): Prefab {
  const b = new PrefabBuilder("fish-market", w + 2, 40, d + 2);
  const x0 = 1;
  const z0 = 1;
  const x1 = w;
  const z1 = d;
  b.footing(MAT_STONE, x0, z0, x1, z1);
  b.solid(MAT_COBBLE, x0, 0, z0, x1, 0, z1);
  for (let x = x0; x <= x1 - 1; x += 8)
    for (const z of [z0, z1 - 1]) b.solid(MAT_STONE, x, 1, z, x + 1, 13, z + 1);
  for (let z = z0; z <= z1 - 1; z += 8)
    for (const x of [x0, x1 - 1]) b.solid(MAT_STONE, x, 1, z, x + 1, 13, z + 1);
  b.solid(MAT_STONE, x1 - 1, 1, z1 - 1, x1, 13, z1);
  b.solid(MAT_TIMBER, x0, 14, z0, x1, 15, z1);
  b.air(x0 + 2, 14, z0 + 2, x1 - 2, 15, z1 - 2);
  for (let x = x0 + 4; x < x1 - 2; x += 8) b.solid(MAT_TIMBER, x, 14, z0, x, 15, z1);
  steppedRoof(b, MAT_SLATE, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 16, "x");
  b.anchor("market-sign", (x0 + x1) >> 1, 15, z0, NZ);
  b.anchor("clock-face", (x0 + x1) >> 1, 20, z0, NZ);
  // Stalls in rows, each a timber counter with fish, ice, scales or nets on it.
  const goods = ["fish-stall", "ice-crate", "scales", "crab-tank", "eel-baskets", "oyster-bar"];
  let g = 0;
  for (let z = z0 + 5; z < z1 - 5; z += 9)
    for (let x = x0 + 5; x < x1 - 7; x += 11, g++) {
      b.solid(MAT_TIMBER, x, 1, z, x + 6, 3, z + 2);
      b.anchor(goods[g % goods.length]!, x + 3, 3, z + 1, UP);
      b.anchor("hanging-lantern", x + 3, 13, z + 1, DOWN);
      b.anchor("stall-awning", x + 3, 3, z, NZ);
    }
  for (let x = x0 + 2; x < x1; x += 6) b.anchor("fish-crates", x, 0, z0 - 1, NZ);
  return b.build();
}

/** A harbour crane: four legs, a cab, a jib reaching out over +z and a counterweight. */
export function crane(): Prefab {
  const b = new PrefabBuilder("crane", 12, 40, 36);
  const z0 = 6;
  b.footing(MAT_STONE, 0, z0, 11, z0 + 11);
  b.solid(MAT_STONE, 0, 0, z0, 11, 1, z0 + 11);
  for (const [x, z] of [
    [1, z0 + 1],
    [9, z0 + 1],
    [1, z0 + 9],
    [9, z0 + 9],
  ] as const)
    b.solid(MAT_PAINT_YELLOW, x, 2, z, x + 1, 22, z + 1);
  for (let y = 7; y <= 17; y += 10) {
    b.solid(MAT_METAL, 1, y, z0 + 1, 10, y, z0 + 1);
    b.solid(MAT_METAL, 1, y, z0 + 10, 10, y, z0 + 10);
    b.solid(MAT_METAL, 1, y, z0 + 1, 1, y, z0 + 10);
    b.solid(MAT_METAL, 10, y, z0 + 1, 10, y, z0 + 10);
  }
  b.solid(MAT_PAINT_YELLOW, 0, 23, z0, 11, 30, z0 + 11);
  b.air(2, 24, z0 + 2, 9, 29, z0 + 9);
  b.air(2, 25, z0 + 11, 9, 28, z0 + 11);
  b.anchor("crane-controls", 5, 23, z0 + 8, UP);
  b.solid(MAT_PAINT_YELLOW, 5, 31, 0, 6, 32, 35);
  b.solid(MAT_STONE, 2, 26, 0, 9, 30, z0 - 1);
  b.anchor("crane-hook", 5, 31, 34, DOWN);
  b.anchor("crane-ladder", 1, 12, z0 + 1, NZ);
  b.anchor("warning-light", 6, 32, 35, UP);
  return b.build();
}

/** A boat on stilts in the boatyard: ribs, half its planking, scaffolding with a ladder. */
export function hullOnStilts(): Prefab {
  const L = 48;
  const W = 17;
  const cx = W >> 1;
  const b = new PrefabBuilder("hull", W + 8, 22, L);
  const ox = 4;
  for (let z = 2; z < L - 2; z += 4) {
    b.solid(MAT_TIMBER, ox + cx - 1, 0, z, ox + cx + 1, 3, z);
    b.footing(MAT_TIMBER, ox + cx - 1, z, ox + cx + 1, z);
  }
  for (let z = 0; z < L; z++) {
    const bow = z < 14 ? 1 + Math.floor((z * 7) / 14) : 8;
    for (let y = 4; y <= 14; y++) {
      const h = Math.max(1, bow - ((14 - y) >> 2));
      const rib = z % 4 === 0;
      const planked = y <= 9 || z < L / 2;
      if (rib || planked) {
        b.solid(rib ? MAT_TIMBER : MAT_PLANKS, ox + cx - h, y, z, ox + cx - h, y, z);
        b.solid(rib ? MAT_TIMBER : MAT_PLANKS, ox + cx + h, y, z, ox + cx + h, y, z);
      }
      if (y === 4) b.solid(MAT_TIMBER, ox + cx - h, y, z, ox + cx + h, y, z);
    }
  }
  // Scaffold walkway along one side, stairs up to it.
  b.solid(MAT_PLANKS, 0, 9, 4, 2, 9, L - 5);
  for (let z = 4; z < L - 4; z += 10) b.solid(MAT_TIMBER, 0, 0, z, 0, 8, z);
  for (let j = 0; j < 9; j++) b.solid(MAT_PLANKS, 0, 0, L - 14 + j, 2, j, L - 14 + j);
  b.anchor("paint-pots", 1, 9, 12, UP);
  b.anchor("sawhorse", W + 6, -1, 8, UP);
  b.anchor("lumber-stack", W + 6, -1, 30, UP);
  b.anchor("tool-rack", 1, 9, 24, UP);
  return b.build();
}

/** A slipway ramp running down along +z from y 0 into the water. */
export function slipway(len: number, width: number, drop: number): Prefab {
  const b = new PrefabBuilder("slipway", width, drop + 2, len);
  for (let z = 0; z < len; z++) {
    const y = drop - Math.min(drop, Math.floor((z * drop) / len));
    b.solid(MAT_PLANKS, 0, y, z, width - 1, y + 1, z);
    b.footing(MAT_STONE, 0, z, width - 1, z, y);
    if (z % 4 === 0) b.paint(MAT_TIMBER, 0, y, z, width - 1, y + 1, z);
  }
  b.anchor("winch", width >> 1, drop + 1, 0, UP);
  return b.build();
}

/** A straight stone stair flight climbing `rise` along +x, cut into whatever is above it. */
export function stairFlight(rise: number, width: number, mat = MAT_STONE): Prefab {
  const b = new PrefabBuilder(`stairs-${rise}`, rise * 2 + 2, rise + 12, width + 2);
  for (let j = 0; j < rise; j++) {
    b.solid(mat, j * 2, 0, 1, j * 2 + 1, j, width);
    b.footing(mat, j * 2, 1, j * 2 + 1, width);
    b.air(j * 2, j + 1, 1, j * 2 + 1, j + 11, width);
  }
  b.air(rise * 2, rise, 1, rise * 2 + 1, rise + 10, width);
  // Low side walls carry the handrails.
  for (let j = 0; j < rise; j += 2) {
    b.anchor("handrail", j * 2, j, 1, NZ);
    b.anchor("handrail", j * 2, j, width, PZ);
  }
  b.anchor("lamp-post", rise * 2 - 1, rise - 1, 1, UP);
  return b.build();
}

/** A plank footbridge along +x with rope rails and posts, sagging gently in the middle. */
export function plankBridge(len: number, width: number): Prefab {
  const b = new PrefabBuilder("plank-bridge", len, 8, width);
  for (let x = 0; x < len; x++) {
    b.solid(MAT_PLANKS, x, 2, 0, x, 3, width - 1);
    if (x % 3 === 0) b.paint(MAT_TIMBER, x, 2, 0, x, 3, width - 1);
  }
  for (const x of [0, len - 1]) {
    b.solid(MAT_TIMBER, x, 0, 0, x, 7, 0);
    b.solid(MAT_TIMBER, x, 0, width - 1, x, 7, width - 1);
    b.footing(MAT_TIMBER, x, 0, x, width - 1);
  }
  for (let x = 2; x < len - 1; x += 3) {
    b.anchor("rope-rail", x, 3, 0, UP);
    b.anchor("rope-rail", x, 3, width - 1, UP);
  }
  b.anchor("bunting", len >> 1, 7, 0, UP);
  return b.build();
}

/** A stone arch bridge along +x: cobbled deck, parapets, and an arch cut out underneath. */
export function archBridge(len: number, width: number, height: number): Prefab {
  const b = new PrefabBuilder("arch-bridge", len, height + 3, width);
  b.solid(MAT_STONE, 0, 0, 0, len - 1, height, width - 1);
  b.paint(MAT_COBBLE, 0, height, 0, len - 1, height, width - 1);
  const half = (len >> 1) - 5;
  const mid = len >> 1;
  for (let x = mid - half; x <= mid + half; x++) {
    const dx = x - mid;
    const top = height - 3 - Math.floor((dx * dx * (height - 3)) / (half * half + 1));
    if (top > 0) b.air(x, 0, 0, x, top, width - 1);
  }
  b.solid(MAT_STONE, 0, height + 1, 0, len - 1, height + 1, 0);
  b.solid(MAT_STONE, 0, height + 1, width - 1, len - 1, height + 1, width - 1);
  b.footing(MAT_STONE, 0, 0, 4, width - 1);
  b.footing(MAT_STONE, len - 5, 0, len - 1, width - 1);
  for (let x = 4; x < len - 4; x += 10) {
    b.anchor("lamp-post", x, height, 1, UP);
    b.anchor("ivy", x + 5, height - 4, 0, NZ);
  }
  return b.build();
}

/** A stone well with a timber frame, little roof and bucket. */
export function well(): Prefab {
  const b = new PrefabBuilder("well", 11, 14, 11);
  b.disc("solid", MAT_STONE, 5, 5, 4, 0, 3);
  b.disc("air", 0, 5, 5, 2, 0, 3);
  b.footing(MAT_STONE, 1, 1, 9, 9);
  b.solid(MAT_TIMBER, 1, 4, 5, 1, 9, 5);
  b.solid(MAT_TIMBER, 9, 4, 5, 9, 9, 5);
  steppedRoof(b, MAT_ROOF_SHINGLE, 0, 2, 10, 8, 10, "x", false);
  b.anchor("well-bucket", 5, 9, 5, DOWN);
  return b.build();
}
const MAT_ROOF_SHINGLE = MAT_TIMBER;

/** A striped beach hut with a little gable roof and a door facing -z. */
export function beachHut(paint: number): Prefab {
  const b = new PrefabBuilder("beach-hut", 10, 14, 10);
  b.footing(MAT_TIMBER, 1, 1, 8, 8);
  b.solid(MAT_PLANKS, 1, 0, 1, 8, 8, 8);
  b.air(2, 1, 2, 7, 8, 7);
  for (let x = 1; x <= 8; x += 2) b.paint(paint, x, 1, 1, x, 8, 8);
  b.air(4, 1, 1, 5, 6, 1);
  steppedRoof(
    b,
    paint === MAT_PAINT_BLUE ? MAT_PAINT_WHITE : MAT_PAINT_RED,
    0,
    0,
    9,
    9,
    9,
    "z",
    false,
  );
  b.anchor("door", 4, 0, 1, NZ);
  b.anchor("deck-chair", 4, -1, 0, UP);
  return b.build();
}

/** A small net shed: plank walls, open front, nets and floats hung inside and out. */
export function netShed(): Prefab {
  const b = new PrefabBuilder("net-shed", 16, 16, 14);
  b.footing(MAT_STONE, 1, 1, 14, 12);
  b.solid(MAT_STONE, 1, 0, 1, 14, 0, 12);
  b.solid(MAT_PLANKS, 1, 1, 1, 14, 9, 12);
  b.air(2, 1, 1, 13, 9, 11);
  b.solid(MAT_TIMBER, 1, 1, 1, 1, 9, 1);
  b.solid(MAT_TIMBER, 14, 1, 1, 14, 9, 1);
  steppedRoof(b, MAT_SLATE, 0, 0, 15, 13, 10, "x", false);
  b.anchor("net-hung", 7, 6, 12, NZ);
  b.anchor("floats", 2, 6, 6, PX);
  b.anchor("oars", 13, 4, 8, NX);
  b.anchor("lobster-pots", 7, 0, 0, UP);
  return b.build();
}

/** A smokehouse: brick, tall chimney, racks of fish inside. */
export function smokehouse(): Prefab {
  const b = new PrefabBuilder("smokehouse", 18, 30, 16);
  b.footing(MAT_STONE, 1, 1, 16, 14);
  b.solid(MAT_BRICK, 1, 0, 1, 16, 12, 14);
  b.air(3, 1, 3, 14, 11, 12);
  b.air(7, 1, 1, 10, 8, 2);
  steppedRoof(b, MAT_SLATE, 0, 0, 17, 15, 13, "x", false);
  b.solid(MAT_BRICK, 13, 13, 6, 15, 25, 8);
  b.anchor("chimney-pot", 14, 25, 7, UP);
  b.anchor("smoke-racks", 8, 0, 8, UP);
  b.anchor("door", 8, 0, 1, NZ);
  b.anchor("sign", 12, 9, 1, NZ);
  return b.build();
}

/** A tall flagpole on a stone base. */
export function flagpole(): Prefab {
  const b = new PrefabBuilder("flagpole", 5, 4, 5);
  b.solid(MAT_STONE, 0, 0, 0, 4, 1, 4);
  b.footing(MAT_STONE, 0, 0, 4, 4);
  b.anchor("flagpole", 2, 1, 2, UP);
  return b.build();
}

export const PAINTS = [
  MAT_PAINT_BLUE,
  MAT_PAINT_RED,
  MAT_PAINT_YELLOW,
  MAT_PAINT_WHITE,
  MAT_PLASTER,
];
