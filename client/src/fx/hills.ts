import { makeRng } from "./rng";

export interface HillSpec {
  seed: number;
  /** Authored world x range. */
  x0: number;
  x1: number;
  /** Baseline height (world y) and wobble amplitude. */
  base: number;
  amp: number;
  /** Horizontal wavelength of the main swell. */
  wavelength: number;
  step: number;
}

/** Hill silhouette as [x, y] points left to right. Deterministic per spec. */
export function hillCurve(spec: HillSpec): [number, number][] {
  const rng = makeRng(spec.seed);
  const p1 = rng() * 6.28;
  const p2 = rng() * 6.28;
  const pts: [number, number][] = [];
  for (let x = spec.x0; x <= spec.x1 + 0.001; x += spec.step) {
    const y =
      spec.base +
      spec.amp *
        (0.65 * Math.sin((x / spec.wavelength) * 6.28 + p1) +
          0.35 * Math.sin((x / (spec.wavelength * 0.43)) * 6.28 + p2));
    pts.push([x, y]);
  }
  return pts;
}

/** Height of the curve at x by linear interpolation (for placing props on the hills). */
export function curveY(pts: [number, number][], x: number): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  const last = pts[pts.length - 1]!;
  if (x >= last[0]) return last[1];
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]![0] <= x) lo = mid;
    else hi = mid;
  }
  const [xa, ya] = pts[lo]!;
  const [xb, yb] = pts[hi]!;
  return ya + ((yb - ya) * (x - xa)) / (xb - xa);
}

/**
 * Where a parallax layer should sit so that it appears to move at `factor` of the camera's speed.
 * factor 1 = glued to the world (the play plane), 0 = glued to the screen.
 * `anchor` is the camera position at which the layer sits exactly where it was authored.
 */
export function parallaxOffset(cam: number, anchor: number, factor: number): number {
  return (cam - anchor) * (1 - factor);
}
