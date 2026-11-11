import * as THREE from "three";
import { copyChunkPadded, type VoxelTerrain } from "@burrow-brawl/shared/src/terrain3d";
import { CHUNK, SAMPLES, type ChunkMesh } from "./mesher";
import { SyncMeshBackend, WorkerMeshBackend, type MeshBackend } from "./backend";
import { makeClayMaterial } from "./clayMaterial";

/**
 * Renders a VoxelTerrain: one mesh per 32^3 chunk (1 voxel = 1 world unit, y up, origin at the
 * voxel (0,0,0) corner). Dirty chunks are found from `chunkVersion`, so edits need no extra calls;
 * a chunk also remeshes when any of its 26 neighbours changed, because its mesh reads a 1-voxel
 * border. Meshing runs in a Web Worker (sync fallback), and stale results are dropped.
 */
export class TerrainMeshes {
  readonly group = new THREE.Group();
  private terrain: VoxelTerrain | undefined;
  private meshes: (THREE.Mesh | undefined)[] = [];
  /** Neighbourhood signature each chunk was last requested at (-1 = never). */
  private requested: number[] = [];
  private inflight = 0;
  private readonly backend: MeshBackend;
  private readonly material: THREE.Material;
  private readonly ownsMaterial: boolean;
  private epoch = 0;

  constructor(
    opts: { backend?: MeshBackend; material?: THREE.Material; maxInflight?: number } = {},
  ) {
    this.backend =
      opts.backend ??
      (typeof Worker !== "undefined" ? new WorkerMeshBackend() : new SyncMeshBackend());
    this.ownsMaterial = !opts.material;
    this.material = opts.material ?? makeClayMaterial();
    this.maxInflight = opts.maxInflight ?? 4;
  }
  private readonly maxInflight: number;

  /** Chunks that still need meshing or are being meshed. */
  get pending(): number {
    const t = this.terrain;
    if (!t) return 0;
    let n = this.inflight;
    for (let i = 0; i < this.requested.length; i++)
      if (this.signature(t, i) !== this.requested[i]) n++;
    return n;
  }

  setTerrain(t: VoxelTerrain | undefined): void {
    this.clear();
    this.terrain = t;
    if (t) {
      const n = t.chunksX * t.chunksY * t.chunksZ;
      this.meshes = new Array(n).fill(undefined);
      this.requested = new Array<number>(n).fill(-1);
    }
  }

  /** Start remeshes for dirty chunks, spending at most budgetMs on copying/dispatch this frame. */
  update(budgetMs = 2): void {
    const t = this.terrain;
    if (!t) return;
    const start = performance.now();
    for (let i = 0; i < this.requested.length; i++) {
      if (this.inflight >= this.maxInflight) break;
      const sig = this.signature(t, i);
      if (sig === this.requested[i]) continue;
      this.requested[i] = sig;
      const block = new Uint8Array(SAMPLES ** 3);
      copyChunkPadded(t, i, block);
      this.inflight++;
      const epoch = this.epoch;
      void this.backend.mesh(block).then((m) => {
        if (epoch !== this.epoch) return;
        this.inflight--;
        if (this.requested[i] === sig) this.swap(t, i, m);
      });
      if (performance.now() - start > budgetMs) break;
    }
  }

  private signature(t: VoxelTerrain, i: number): number {
    const cx = i % t.chunksX;
    const cz = Math.floor(i / t.chunksX) % t.chunksZ;
    const cy = Math.floor(i / (t.chunksX * t.chunksZ));
    let s = 0;
    for (let y = Math.max(0, cy - 1); y <= Math.min(t.chunksY - 1, cy + 1); y++)
      for (let z = Math.max(0, cz - 1); z <= Math.min(t.chunksZ - 1, cz + 1); z++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(t.chunksX - 1, cx + 1); x++)
          s += t.chunkVersion[(y * t.chunksZ + z) * t.chunksX + x]!;
    return s;
  }

  private swap(t: VoxelTerrain, i: number, m: ChunkMesh): void {
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
    mesh.position.set(
      (i % t.chunksX) * CHUNK,
      Math.floor(i / (t.chunksX * t.chunksZ)) * CHUNK,
      (Math.floor(i / t.chunksX) % t.chunksZ) * CHUNK,
    );
    this.meshes[i] = mesh;
    this.group.add(mesh);
  }

  private clear(): void {
    this.epoch++;
    this.inflight = 0;
    for (const m of this.meshes) m?.geometry.dispose();
    this.meshes = [];
    this.requested = [];
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.terrain = undefined;
    this.backend.dispose();
    if (this.ownsMaterial) this.material.dispose();
  }
}
