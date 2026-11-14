// A small helper for writing prefabs in code: boxes, discs and rings in local voxels, plus decor
// anchors. Everything is integer. Parts apply in the order they are added (later parts win).

import { isqrt } from "../../fixed.js";
import type { Prefab, PrefabAnchor, PrefabPart } from "../prefab.js";

/** Faces, as in DecorAnchor: +x, +z, -x, -z, up, down. */
export const PX = 0;
export const PZ = 1;
export const NX = 2;
export const NZ = 3;
export const UP = 4;
export const DOWN = 5;

export class PrefabBuilder {
  readonly parts: PrefabPart[] = [];
  readonly anchors: PrefabAnchor[] = [];

  constructor(
    readonly id: string,
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {}

  private add(
    op: PrefabPart["op"],
    mat: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): this {
    this.parts.push({ op, mat, x0, y0, z0, x1, y1, z1 });
    return this;
  }

  solid(mat: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.add("solid", mat, x0, y0, z0, x1, y1, z1);
  }

  air(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.add("air", 0, x0, y0, z0, x1, y1, z1);
  }

  paint(mat: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.add("paint", mat, x0, y0, z0, x1, y1, z1);
  }

  /** Fill each column of the rectangle down from y0 - 1 to the ground. */
  footing(mat: number, x0: number, z0: number, x1: number, z1: number, y0 = 0) {
    return this.add("footing", mat, x0, y0, z0, x1, y0, z1);
  }

  anchor(kind: string, x: number, y: number, z: number, face: number) {
    this.anchors.push({ kind, x, y, z, face });
    return this;
  }

  /**
   * A disc of radius r (voxels whose centre offset satisfies dx^2 + dz^2 <= r^2 + r) centred on
   * voxel (cx, cz), as one box per row.
   */
  disc(
    op: "solid" | "air" | "paint",
    mat: number,
    cx: number,
    cz: number,
    r: number,
    y0: number,
    y1: number,
  ) {
    const rr = r * r + r;
    for (let dz = -r; dz <= r; dz++) {
      const half = isqrt(rr - dz * dz);
      this.add(op, mat, cx - half, y0, cz + dz, cx + half, y1, cz + dz);
    }
    return this;
  }

  /** A ring: the disc of radius r minus the disc of radius r - thick, as up to two boxes per row. */
  ring(
    op: "solid" | "paint",
    mat: number,
    cx: number,
    cz: number,
    r: number,
    thick: number,
    y0: number,
    y1: number,
  ) {
    const rr = r * r + r;
    const ri = r - thick;
    const rri = ri * ri + ri;
    for (let dz = -r; dz <= r; dz++) {
      const half = isqrt(rr - dz * dz);
      if (Math.abs(dz) > ri) {
        this.add(op, mat, cx - half, y0, cz + dz, cx + half, y1, cz + dz);
        continue;
      }
      const inner = isqrt(rri - dz * dz);
      this.add(op, mat, cx - half, y0, cz + dz, cx - inner - 1, y1, cz + dz);
      this.add(op, mat, cx + inner + 1, y0, cz + dz, cx + half, y1, cz + dz);
    }
    return this;
  }

  /** Voxels on the outline of a disc of radius r, in a fixed order (for railings and posts). */
  static rim(r: number): [dx: number, dz: number][] {
    const rr = r * r + r;
    const out: [number, number][] = [];
    for (let dz = -r; dz <= r; dz++) {
      const half = isqrt(rr - dz * dz);
      out.push([-half, dz], [half, dz]);
    }
    return out;
  }

  build(): Prefab {
    return {
      id: this.id,
      sx: this.sx,
      sy: this.sy,
      sz: this.sz,
      parts: this.parts,
      anchors: this.anchors,
    };
  }
}
