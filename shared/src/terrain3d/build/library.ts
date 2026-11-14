/**
 * Landmark buildings baked from CC0 library models (tools/assets/bake_prefab.py, prefabs/*.json):
 * solid, walkable voxel shells with floors and a doorway. The bakes carry no detail anchors, so
 * this adds a lamp either side of the doorway and a weathervane on the highest roof column.
 */
import type { Prefab, PrefabAnchor } from "../prefab.js";
import church from "../prefabs/kaykit-church.json";
import homeA from "../prefabs/kaykit-home-a.json";
import homeB from "../prefabs/kaykit-home-b.json";
import tavern from "../prefabs/kaykit-tavern.json";
import tower from "../prefabs/kaykit-tower.json";
import watermill from "../prefabs/kaykit-watermill.json";
import windmill from "../prefabs/kaykit-windmill.json";

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

type Baked = Omit<Prefab, "parts" | "anchors"> & {
  readonly parts: readonly (Prefab["parts"][number] & { readonly op: string })[];
  readonly door?: Box | null;
};

export interface Landmark {
  readonly prefab: Prefab;
  /** Side the doorway opens on, as a DecorAnchor face (0 +x, 1 +z, 2 -x, 3 -z). */
  readonly doorSide: number;
}

/** The side of the footprint a doorway box touches. */
function sideOf(p: Baked, d: Box): number {
  const gaps = [p.sx - 1 - d.x1, p.sz - 1 - d.z1, d.x0, d.z0];
  let best = 0;
  for (let i = 1; i < 4; i++) if (gaps[i]! < gaps[best]!) best = i;
  return best;
}

function landmark(raw: unknown): Landmark {
  const p = raw as Baked;
  const anchors: PrefabAnchor[] = [];
  const d = p.door;
  const side = d ? sideOf(p, d) : 1;
  if (d) {
    // Lamps on the outer wall either side of the doorway, two voxels above its top.
    const y = Math.min(p.sy - 1, d.y1 + 2);
    if (side === 0 || side === 2) {
      const x = side === 0 ? d.x1 : d.x0;
      anchors.push({ kind: "lamp-wall", x, y, z: d.z0 - 1, face: side });
      anchors.push({ kind: "lamp-wall", x, y, z: d.z1 + 1, face: side });
    } else {
      const z = side === 1 ? d.z1 : d.z0;
      anchors.push({ kind: "lamp-wall", x: d.x0 - 1, y, z, face: side });
      anchors.push({ kind: "lamp-wall", x: d.x1 + 1, y, z, face: side });
    }
  }
  // Weathervane on the top of the highest solid box.
  let top: Box | null = null;
  for (const part of p.parts) if (part.op === "solid" && (!top || part.y1 > top.y1)) top = part;
  if (top)
    anchors.push({
      kind: "weathervane",
      x: (top.x0 + top.x1) >> 1,
      y: top.y1,
      z: (top.z0 + top.z1) >> 1,
      face: 4,
    });
  return {
    prefab: { id: p.id, sx: p.sx, sy: p.sy, sz: p.sz, parts: p.parts as Prefab["parts"], anchors },
    doorSide: side,
  };
}

export const LANDMARKS = {
  church: landmark(church),
  homeA: landmark(homeA),
  homeB: landmark(homeB),
  tavern: landmark(tavern),
  tower: landmark(tower),
  watermill: landmark(watermill),
  windmill: landmark(windmill),
} as const;

/** Quarter turns that bring a landmark's doorway round to face `side`. */
export function turnToFace(l: Landmark, side: number): number {
  return (side - l.doorSide + 4) & 3;
}
