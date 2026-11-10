# Terrain spec (task S2 design draft)

Status: draft by feature builder (Sonnet), for manager review. No code until the manager gives the go-ahead and a repo location.

Scope: the destructible terrain mask in `/shared`, its carving API, chunked marching-squares meshing in `/client`, and the collision queries the sim (S3/S4) will use. Everything in `/shared` must be deterministic: integer math only, no floats in anything that affects game state.

## 1. Data model (`shared/terrain`)

Grid: `width x height` cells, default 2048 x 1024, 1 cell = 1 world unit (so a critter is roughly 24 cells tall; tune later). Origin top-left, +y down in mask space. The client flips y when building meshes.

Each cell is one byte in a `Uint8Array` (`cells[y * width + x]`):

| Value | Material | Destructible | Notes |
|---|---|---|---|
| 0 | Air | n/a | Empty |
| 1 | Crust | yes | Top layer, grassy cake frosting |
| 2 | Dirt | yes | Default fill |
| 3 | Clay | yes | Visual variant, same rules in v1 |
| 255 | Bedrock | no | Carving skips it; used for map floor/borders |

Solid means `value != 0`. Material is only for visuals and future rules (e.g. harder clay); v1 collision treats all non-zero as solid. The "soda" level is not in the mask; it is a y threshold owned by the match state.

```ts
interface Terrain {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  readonly chunkSize: number;          // 64
  readonly chunkVersion: Uint32Array;  // per chunk, bumped on any change
  readonly dirtyChunks: Set<number>;   // consumed by the renderer
}
```

`dirtyChunks` and `chunkVersion` are derived render state: excluded from state hashes and snapshots. The hash covers `cells` only.

## 2. API

```ts
createTerrain(width, height): Terrain
isSolid(t, x, y): boolean                 // out of bounds: x outside => solid wall? see 2.1
materialAt(t, x, y): number
carveCircle(t, cx, cy, r): CarveResult    // integer args
carveRect(t, x0, y0, x1, y1): CarveResult // for Drill Hat tunnels (optionally a capsule, see 6)
addCircle(t, cx, cy, r, material): void   // for later: bridge/girder-style weapons
raycast(t, x0, y0, x1, y1): {hit: boolean, x: number, y: number} // integer DDA, for hitscan + grappling
surfaceNormal(t, x, y): {nx: number, ny: number} // see 4
serialize(t): Uint8Array / deserialize     // RLE compressed, for snapshots and map files
hashTerrain(t): number                    // FNV-1a over cells
```

`CarveResult` returns `{ cellsRemoved: number, bounds: {x0,y0,x1,y1} }` so the sim can skip knockback/fall logic when nothing changed.

### 2.1 Out of bounds

- Left, right, top: treated as air (projectiles that leave are removed by sim rules, not by terrain).
- Below `height`: air, but the sim treats everything under the soda line as lethal.
- Rationale: maps are authored with bedrock borders where a wall is wanted.

### 2.2 Carving algorithm

Integer circle test: a cell `(x, y)` is removed when `(x-cx)^2 + (y-cy)^2 <= r^2`. Iterate only the bounding box clamped to the grid, per-row span fill. Skip cells equal to 255. For each changed cell, mark its chunk dirty (and neighbour chunks if the cell lies on a chunk edge, because meshes sample one cell across the boundary). Cost is O(r^2), fine for r up to about 80.

Explosion shaping: v1 uses plain circles. A later polish pass can add a noisy rim (seeded PRNG, integer) so craters look chewed. Keep an optional `rimNoise` parameter off by default so the first version stays easy to test.

## 3. Meshing (`client/terrain`)

Chunks of 64 x 64 cells (32 x 16 chunks for the default map). Each chunk owns one `THREE.Mesh` made of:

1. **Face mesh (front plane):** marching squares over the chunk's cells plus a 1-cell apron from neighbours. Use the standard 16-case table on the corner solidity of each 2x2 sample window. Output triangles for the filled region. Vertices on the contour lie at edge midpoints (no interpolation needed because the mask is binary; this keeps contours stable and cheap).
2. **Extrusion (depth):** for every contour segment emit a quad of fixed depth `D` (default 24 world units) along -z, giving the chunky cake-slice side walls. A back plane closes the shape.
3. **Contour smoothing:** optional one pass of Chaikin corner cutting on the contour polyline in the client only, to soften pixel stairs. Collision always reads the raw mask, so smoothing must stay small (under 1 cell of deviation).

Material per cell drives vertex color or a texture-atlas UV on the face mesh (crust band near the surface, dirt below, clay as noise patches). Outline pass: back-face inverted-hull or edge lines from the contour, matching the thick-outline style in the game plan.

Rebuild policy: each frame, rebuild at most `N` dirty chunks (default 4), oldest first, so a huge blast does not hitch. Chunks whose version did not change are never rebuilt. Empty chunks (all air) get no mesh; fully solid chunks use a cheap 2-triangle quad plus border contour only. Dispose old geometry on rebuild.

Target: rebuilding one 64x64 chunk under 2 ms on a mid laptop.

## 4. Collision queries for the sim

The sim never touches meshes. It uses:

- `isSolid` for point probes (critter feet, projectile centre).
- Critter ground contact: sample a short row of probes under the critter's feet; step-up is allowed for slopes up to `maxStep` cells (default 3), which gives the critter smooth walking over bumpy terrain.
- `surfaceNormal(x, y)`: sum the Sobel-like gradient of solidity over a 5 x 5 window around the point, return the normalised vector in integer-friendly fixed point (normalise with a deterministic integer sqrt, no `Math.sqrt` on floats if it affects state; use a lookup or fixed-point Newton). Used for grenade bounce and critter slide.
- `raycast`: integer Bresenham/DDA, returns the first solid cell, for hitscan, rope claw anchor, and teleport/placement validation.

All sim-facing results are integers or fixed-point (16.16) so cross-platform determinism holds.

## 5. Map generation hook (H3 dependency)

A map is `{ width, height, cells (RLE), spawnPoints[], seed }`. The procedural generator (H3) produces the mask; this spec only fixes the format. Required post-process, owned by terrain code: `settle(t)` is NOT in v1 (no falling dirt); islands that become disconnected stay floating, which is the classic and simplest behaviour.

## 6. Performance and limits

- Mask memory: 2 MB at default size. Fine to copy for snapshots; use RLE for network.
- Carve: under 0.2 ms for r = 40.
- Mesh rebuild budget: 4 chunks/frame.
- Drill Hat: model as repeated `carveCircle` along a swept path (capsule) at sim ticks, not a single huge rect, so each step is deterministic and cheap.

## 7. Tests (Vitest, `/shared`)

1. Carve empties exactly the cells within radius, never touches bedrock.
2. Carve at map edges and with a circle fully outside the map is a no-op and returns `cellsRemoved: 0`.
3. Chunk dirtiness: a carve straddling a chunk border dirties both chunks and only those.
4. `hashTerrain` is stable across runs; two terrains given the same carve sequence hash equal.
5. `serialize/deserialize` round-trips.
6. `raycast` hits the first solid cell on axis-aligned and diagonal lines, and returns `hit: false` through air.
7. `surfaceNormal` on a flat floor points up, on a 45 degree slope is near (+-0.707, -0.707).
8. Client-side (jsdom or pure function): the marching-squares table function returns the expected segment count for each of the 16 cases; a filled chunk yields only the border.

## 8. Milestones inside S2

1. `shared/terrain`: data, carve, raycast, hash, serialize, tests.
2. `client/terrain`: marching squares mesh + extrusion, chunk manager, dirty rebuild.
3. Debug tool: click on the map in the S1 client to carve a circle (radius slider in the debug HUD), with a mask overlay toggle.
4. Perf pass against the budgets above.

## 9. Decisions (confirmed by manager)

1. Fixed-point: Q16.16 stored in int32, with helpers in `shared/fixed.ts` (shared with O2's determinism work).
2. Default map size: 2048 x 1024 cells, 1 cell = 1 world unit.
3. The terrain module owns `serialize`/`deserialize`/`hashTerrain`. The systems engineer owns the wire protocol: initial full mask plus seed, then carve events by default, with a full resync when the hash does not match.
4. No falling dirt or settling in v1.

Repo: `lucascollins-11/burrow-brawl` (pending creation by Lucas). No code until the manager sends the go-ahead.
