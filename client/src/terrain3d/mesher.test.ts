import { describe, expect, it } from "vitest";
import { CHUNK, SAMPLES, meshBlock } from "./mesher";

/** Padded block holding a solid sphere (smooth falloff) centred in the chunk. */
function sphereBlock(cx: number, cy: number, cz: number, r: number): Uint8Array {
  const b = new Uint8Array(SAMPLES * SAMPLES * SAMPLES);
  for (let y = 0; y < SAMPLES; y++)
    for (let z = 0; z < SAMPLES; z++)
      for (let x = 0; x < SAMPLES; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
        b[(y * SAMPLES + z) * SAMPLES + x] = Math.max(
          0,
          Math.min(255, Math.round(128 + (r - d) * 64)),
        );
      }
  return b;
}

describe("meshBlock", () => {
  it("empty and full blocks produce no geometry", () => {
    expect(meshBlock(new Uint8Array(SAMPLES ** 3)).indices.length).toBe(0);
    expect(meshBlock(new Uint8Array(SAMPLES ** 3).fill(255)).indices.length).toBe(0);
  });

  it("sphere mesh is closed with outward normals and winding", () => {
    const c = CHUNK / 2 + 1;
    const m = meshBlock(sphereBlock(c, c, c, 9.3));
    expect(m.indices.length).toBeGreaterThan(300);
    const edges = new Map<string, number>();
    let outward = 0;
    let total = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, d] = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!];
      for (const [p, q] of [
        [a, b],
        [b, d],
        [d, a],
      ] as const) {
        const k = `${p}>${q}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
      const P = (v: number) => [
        m.positions[v * 3]!,
        m.positions[v * 3 + 1]!,
        m.positions[v * 3 + 2]!,
      ];
      const A = P(a),
        B = P(b),
        D = P(d);
      const n = [
        (B[1]! - A[1]!) * (D[2]! - A[2]!) - (B[2]! - A[2]!) * (D[1]! - A[1]!),
        (B[2]! - A[2]!) * (D[0]! - A[0]!) - (B[0]! - A[0]!) * (D[2]! - A[2]!),
        (B[0]! - A[0]!) * (D[1]! - A[1]!) - (B[1]! - A[1]!) * (D[0]! - A[0]!),
      ];
      const out = [A[0]! - c, A[1]! - c, A[2]! - c];
      const dot = n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!;
      total++;
      if (dot > 0) outward++;
    }
    expect(outward).toBe(total);
    // closed manifold: every directed edge has its reverse exactly once
    for (const [k, n] of edges) {
      expect(n).toBe(1);
      const [p, q] = k.split(">");
      expect(edges.get(`${q}>${p}`)).toBe(1);
    }
    // normals point outward too
    for (let v = 0; v < m.vertexCount; v++) {
      const dx = m.positions[v * 3]! - c,
        dy = m.positions[v * 3 + 1]! - c,
        dz = m.positions[v * 3 + 2]! - c;
      expect(
        dx * m.normals[v * 3]! + dy * m.normals[v * 3 + 1]! + dz * m.normals[v * 3 + 2]!,
      ).toBeGreaterThan(0);
    }
  });

  // Wall-clock check: typically 2 to 4 ms. The bound is loose because CI runs tests in parallel.
  it("meshes a 32^3 chunk in a few milliseconds", () => {
    const c = CHUNK / 2 + 1;
    const blk = sphereBlock(c, c, c, 13);
    meshBlock(blk);
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      meshBlock(blk);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(25);
  });
});
