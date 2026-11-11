import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyEdit, createTerrain } from "@burrow-brawl/shared/src/terrain3d";
import { SyncMeshBackend } from "./backend";
import { TerrainMeshes } from "./terrainMeshes";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(m: TerrainMeshes) {
  for (let i = 0; i < 30 && m.pending; i++) {
    m.update(100);
    await flush();
  }
}
function island() {
  const t = createTerrain(96, 64, 96, 3, 10);
  applyEdit(t, { op: "box", x0: 0, y0: 0, z0: 0, x1: 95, y1: 20, z1: 95 });
  t.edits.length = 0;
  t.chunkVersion.fill(0);
  return t;
}
const make = () =>
  new TerrainMeshes({ backend: new SyncMeshBackend(), material: new THREE.MeshBasicMaterial() });

describe("TerrainMeshes", () => {
  it("meshes the surface chunks and leaves empty ones out", async () => {
    const m = make();
    m.setTerrain(island());
    await settle(m);
    expect(m.group.children.length).toBe(9); // 3x3 chunks cross y=20; the rest are empty
    expect(m.pending).toBe(0);
  });

  it("remeshes only the edited chunk and its neighbourhood after an edit", async () => {
    const t = island();
    const m = make();
    m.setTerrain(t);
    await settle(m);
    const before = new Set(m.group.children);
    applyEdit(t, { op: "carve", x: 16, y: 20, z: 16, r: 5 }); // inside chunk (0,0,0), away from borders
    expect(m.pending).toBe(8); // chunk + 7 neighbours (corner of the grid)
    await settle(m);
    const kept = [...before].filter((c) => m.group.children.includes(c)).length;
    expect(kept).toBeGreaterThanOrEqual(5); // far chunks keep their meshes
    expect(m.pending).toBe(0);
  });

  it("drops stale work when the terrain is replaced", async () => {
    const m = make();
    m.setTerrain(island());
    m.update(100);
    m.setTerrain(island());
    await settle(m);
    expect(m.group.children.length).toBe(9);
    m.dispose();
    expect(m.group.children.length).toBe(0);
  });
});
