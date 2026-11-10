import * as THREE from "three";
import type { MeshBackend } from "./backend";
import { CHUNK, SAMPLES, extractBlock, type DensityGridLike } from "./mesher";

/**
 * Keeps one mesh per 32^3 chunk. Only dirty chunks are remeshed (a bounded number
 * of requests per `update`), and results from superseded requests are dropped.
 */
export class ChunkManager {
  readonly group = new THREE.Group();
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  private readonly meshes: (THREE.Mesh | undefined)[];
  private readonly dirty = new Set<number>();
  private readonly version: number[];
  private inflight = 0;
  private disposed = false;

  constructor(
    private readonly grid: DensityGridLike,
    private readonly backend: MeshBackend,
    private readonly material: THREE.Material,
    private readonly maxInflight = 4,
  ) {
    this.nx = grid.width / CHUNK;
    this.ny = Math.ceil(grid.height / CHUNK);
    this.nz = grid.depth / CHUNK;
    const n = this.nx * this.ny * this.nz;
    this.meshes = new Array(n).fill(undefined);
    this.version = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) this.dirty.add(i);
  }

  get pending(): number {
    return this.dirty.size + this.inflight;
  }

  /** Mark chunks overlapping a voxel box (inclusive) dirty; the box grows by 1 for seam samples. */
  markDirtyBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const lo = (v: number) => Math.floor((v - 1) / CHUNK);
    const hi = (v: number) => Math.floor((v + 1) / CHUNK);
    for (let cy = Math.max(0, lo(y0)); cy <= Math.min(this.ny - 1, hi(y1)); cy++)
      for (let cz = Math.max(0, lo(z0)); cz <= Math.min(this.nz - 1, hi(z1)); cz++)
        for (let cx = Math.max(0, lo(x0)); cx <= Math.min(this.nx - 1, hi(x1)); cx++)
          this.dirty.add(this.idx(cx, cy, cz));
  }

  /** Sphere edit helper: dirty everything the sphere touches. */
  markDirtySphere(x: number, y: number, z: number, r: number): void {
    this.markDirtyBox(x - r, y - r, z - r, x + r, y + r, z + r);
  }

  /** Kick off remeshes for dirty chunks, up to the in-flight limit. Call once per frame. */
  update(): void {
    if (this.disposed) return;
    for (const i of this.dirty) {
      if (this.inflight >= this.maxInflight) break;
      this.dirty.delete(i);
      this.request(i);
    }
  }

  private idx(cx: number, cy: number, cz: number): number {
    return (cy * this.nz + cz) * this.nx + cx;
  }

  private request(i: number): void {
    const cx = i % this.nx;
    const cz = Math.floor(i / this.nx) % this.nz;
    const cy = Math.floor(i / (this.nx * this.nz));
    const v = ++this.version[i]!;
    const block = new Uint8Array(SAMPLES ** 3);
    extractBlock(this.grid, cx, cy, cz, block);
    this.inflight++;
    void this.backend.mesh(block).then((m) => {
      this.inflight--;
      if (this.disposed || this.version[i] !== v) return; // superseded
      this.replace(i, cx, cy, cz, m);
    });
  }

  private replace(
    i: number,
    cx: number,
    cy: number,
    cz: number,
    m: { positions: Float32Array; normals: Float32Array; indices: Uint32Array },
  ): void {
    const old = this.meshes[i];
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes[i] = undefined;
    }
    if (m.indices.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(cx * CHUNK, cy * CHUNK, cz * CHUNK);
    this.meshes[i] = mesh;
    this.group.add(mesh);
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.meshes) m?.geometry.dispose();
    this.meshes.fill(undefined);
    this.group.clear();
    this.backend.dispose();
  }
}
