import type { Terrain } from "@burrow-brawl/shared";
import { BEDROCK, CLAY, CRUST, DIRT } from "@burrow-brawl/shared";
import * as THREE from "three";
import { marchChunk } from "./march";

/** Pastel toy-box palette (original). */
const MATERIAL_COLORS = new Map<number, THREE.Color>([
  [CRUST, new THREE.Color(0xf4a6b8)],
  [DIRT, new THREE.Color(0xb98a5e)],
  [CLAY, new THREE.Color(0xd9784f)],
  [BEDROCK, new THREE.Color(0x6f7a8f)],
]);
const FALLBACK = new THREE.Color(0xff00ff);

export interface TerrainRendererOptions {
  /** Extrusion depth in world units. */
  depth?: number;
  /** Max chunks rebuilt per update() call. */
  chunkBudget?: number;
}

/**
 * Owns one mesh per terrain chunk. The mask is in +y-down cells; the world is +y-up,
 * so cell (x, y) maps to world (x, -y). The front face sits at z = depth / 2.
 */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Object3D>();
  private readonly faceMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: 0x3b2a1a });
  private readonly depth: number;
  private readonly budget: number;

  constructor(
    private terrain: Terrain,
    options: TerrainRendererOptions = {},
  ) {
    this.depth = options.depth ?? 24;
    this.budget = options.chunkBudget ?? 4;
    this.group.name = "terrain";
  }

  /** Follow a new terrain object (the sim copies the mask when an explosion carves it). */
  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
  }

  setWireframe(on: boolean): void {
    this.faceMaterial.wireframe = on;
  }

  private firstUpdate = true;

  /**
   * Rebuild up to `chunkBudget` dirty chunks, oldest first. The very first call builds
   * every chunk so the map appears at once; later blasts are spread over frames.
   * Returns the number rebuilt.
   */
  update(): number {
    const budget = this.firstUpdate ? Infinity : this.budget;
    this.firstUpdate = false;
    let n = 0;
    for (const index of this.terrain.dirtyChunks) {
      if (n >= budget) break;
      this.terrain.dirtyChunks.delete(index);
      this.rebuild(index);
      n++;
    }
    return n;
  }

  get pendingChunks(): number {
    return this.terrain.dirtyChunks.size;
  }

  dispose(): void {
    for (const index of [...this.meshes.keys()]) this.remove(index);
    this.faceMaterial.dispose();
    this.edgeMaterial.dispose();
  }

  private remove(index: number): void {
    const old = this.meshes.get(index);
    if (!old) return;
    this.group.remove(old);
    old.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.meshes.delete(index);
  }

  private rebuild(index: number): void {
    this.remove(index);
    const t = this.terrain;
    const g = marchChunk(t, index % t.chunksX, Math.floor(index / t.chunksX));
    if (g.fill.length === 0) return; // empty chunk: no mesh

    const front = this.depth / 2;
    const back = -this.depth / 2;
    const tris = g.fill.length / 6;
    const sideTris = (g.edges.length / 4) * 2;
    const pos = new Float32Array((tris * 3 + sideTris * 3) * 3);
    const col = new Float32Array(pos.length);
    let p = 0;
    const put = (x: number, y: number, z: number, c: THREE.Color): void => {
      pos[p] = x;
      pos[p + 1] = -y;
      pos[p + 2] = z;
      col[p] = c.r;
      col[p + 1] = c.g;
      col[p + 2] = c.b;
      p += 3;
    };

    for (let i = 0; i < tris; i++) {
      const c = MATERIAL_COLORS.get(g.fillMaterial[i] ?? 0) ?? FALLBACK;
      for (let k = 0; k < 3; k++)
        put(g.fill[i * 6 + k * 2] ?? 0, g.fill[i * 6 + k * 2 + 1] ?? 0, front, c);
    }
    // Side walls along the contour, shaded darker so the cake slice reads as chunky.
    const side = new THREE.Color(0x8a5f3c);
    for (let i = 0; i < g.edges.length; i += 4) {
      const [x0, y0, x1, y1] = [
        g.edges[i] ?? 0,
        g.edges[i + 1] ?? 0,
        g.edges[i + 2] ?? 0,
        g.edges[i + 3] ?? 0,
      ];
      put(x0, y0, front, side);
      put(x1, y1, front, side);
      put(x1, y1, back, side);
      put(x0, y0, front, side);
      put(x1, y1, back, side);
      put(x0, y0, back, side);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const chunk = new THREE.Group();
    chunk.add(new THREE.Mesh(geo, this.faceMaterial));

    if (g.edges.length > 0) {
      const lines = new Float32Array((g.edges.length / 4) * 6);
      for (let i = 0, j = 0; i < g.edges.length; i += 4, j += 6) {
        lines[j] = g.edges[i] ?? 0;
        lines[j + 1] = -(g.edges[i + 1] ?? 0);
        lines[j + 2] = front + 0.1;
        lines[j + 3] = g.edges[i + 2] ?? 0;
        lines[j + 4] = -(g.edges[i + 3] ?? 0);
        lines[j + 5] = front + 0.1;
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      chunk.add(new THREE.LineSegments(lg, this.edgeMaterial));
    }

    this.meshes.set(index, chunk);
    this.group.add(chunk);
  }
}
