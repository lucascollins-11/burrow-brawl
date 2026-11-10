import * as THREE from "three";

// A stand-in island until terrain3d and its meshing worker land: a deterministic heightfield on the
// default 256 x 256 footprint, drawn as one mesh. The renderer only needs `heightAt` to stand critters
// on, so swapping in the real voxel mesh later changes nothing else.

export const WORLD = { w: 256, d: 256, h: 96 };
export const FAKE_SEA_Y = 14;

/** Pure integer-ish hash noise so the island is the same every run. */
function hash(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  const u = s(fx);
  return a + (b - a) * u + (c - a) * s(fz) + (a - b - c + d) * u * s(fz);
}

export function heightAt(x: number, z: number): number {
  const dx = (x - WORLD.w / 2) / (WORLD.w / 2);
  const dz = (z - WORLD.d / 2) / (WORLD.d / 2);
  const r = Math.hypot(dx, dz);
  const island = Math.max(0, 1 - r * r * 1.15);
  const hills = valueNoise(x / 38, z / 38) * 26 + valueNoise(x / 14, z / 14) * 6;
  return 4 + island * (22 + hills);
}

const TOP = new THREE.Color(0x9bd16b);
const DIRT = new THREE.Color(0xb98255);
const SAND = new THREE.Color(0xf0d9a0);

export function buildFakeTerrain(step = 2): THREE.Mesh {
  const nx = WORLD.w / step + 1;
  const nz = WORLD.d / step + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * step;
      const z = j * step;
      const y = heightAt(x, z);
      const k = (j * nx + i) * 3;
      pos.set([x, y, z], k);
      const slope = Math.abs(heightAt(x + 2, z) - y) + Math.abs(heightAt(x, z + 2) - y);
      if (y < FAKE_SEA_Y + 2) c.copy(SAND);
      else c.copy(TOP).lerp(DIRT, Math.min(1, slope / 5));
      col.set([c.r, c.g, c.b], k);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true;
  m.castShadow = true;
  m.name = "fake-terrain";
  return m;
}
