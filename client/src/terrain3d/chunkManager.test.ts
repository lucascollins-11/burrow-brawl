import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SyncMeshBackend } from "./backend";
import { ChunkManager } from "./chunkManager";
import type { DensityGridLike } from "./mesher";

function sphereGrid(): DensityGridLike {
  const width = 64,
    depth = 64,
    height = 64;
  const density = new Uint8Array(width * depth * height);
  for (let y = 0; y < height; y++)
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        const d = Math.hypot(x - 31.6, y - 32.3, z - 32.7); // sphere straddling all chunk borders
        density[(y * depth + z) * width + x] = Math.max(
          0,
          Math.min(255, Math.round(128 + (14 - d) * 64)),
        );
      }
  return { width, depth, height, density };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function settle(cm: ChunkManager) {
  for (let i = 0; i < 20 && cm.pending; i++) {
    cm.update();
    await flush();
  }
}

/** Boundary edges (used by exactly one triangle) over world-space welded vertices. */
function openEdges(cm: ChunkManager): number {
  const key = (p: THREE.Vector3) =>
    `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;
  const edges = new Map<string, number>();
  for (const obj of cm.group.children) {
    const g = (obj as THREE.Mesh).geometry;
    const pos = g.getAttribute("position");
    const idx = g.getIndex()!;
    const v = (i: number) => key(new THREE.Vector3().fromBufferAttribute(pos, i).add(obj.position));
    for (let t = 0; t < idx.count; t += 3) {
      const a = v(idx.getX(t)),
        b = v(idx.getX(t + 1)),
        c = v(idx.getX(t + 2));
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const k = p < q ? `${p}|${q}` : `${q}|${p}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n === 1) open++; // n=1 is a crack; n=4 is a welded pole, harmless
  return open;
}

describe("ChunkManager", () => {
  it("meshes across chunk borders with no cracks", async () => {
    const cm = new ChunkManager(sphereGrid(), new SyncMeshBackend(), new THREE.MeshBasicMaterial());
    await settle(cm);
    expect(cm.group.children.length).toBe(8);
    expect(openEdges(cm)).toBe(0);
  });

  it("remeshes only dirty chunks after an edit", async () => {
    const grid = sphereGrid();
    const cm = new ChunkManager(grid, new SyncMeshBackend(), new THREE.MeshBasicMaterial());
    await settle(cm);
    const before = new Set(cm.group.children);
    // carve well inside chunk (0,0,0)
    for (let z = 4; z < 8; z++)
      for (let x = 4; x < 8; x++)
        for (let y = 4; y < 8; y++) grid.density[(y * 64 + z) * 64 + x] = 255;
    cm.markDirtySphere(6, 6, 6, 3);
    expect(cm.pending).toBe(1);
    await settle(cm);
    const after = new Set(cm.group.children);
    expect([...after].filter((m) => !before.has(m)).length).toBeLessThanOrEqual(1);
    expect([...before].filter((m) => after.has(m)).length).toBeGreaterThanOrEqual(7);
  });

  it("drops results from superseded requests", async () => {
    const grid = sphereGrid();
    const cm = new ChunkManager(grid, new SyncMeshBackend(), new THREE.MeshBasicMaterial());
    cm.update();
    cm.markDirtyBox(0, 0, 0, 1, 1, 1);
    await settle(cm);
    expect(cm.group.children.length).toBe(8);
  });
});
