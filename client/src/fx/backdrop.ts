import * as THREE from "three";
import { curveY, hillCurve, parallaxOffset, type HillSpec } from "./hills";
import { PALETTE } from "./palette";
import { makeRng } from "./rng";

const INK = PALETTE.ink;
const LINE = 9; // outline thickness in world units
const circleGeo = new THREE.CircleGeometry(1, 20);
const quadGeo = new THREE.PlaneGeometry(1, 1);
const mats = new Map<number, THREE.MeshBasicMaterial>();
function mat(color: number): THREE.MeshBasicMaterial {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshBasicMaterial({ color })));
  return m;
}

/** Disc with an ink outline: dark disc behind, colored disc in front. */
function disc(g: THREE.Group, x: number, y: number, r: number, color: number, z = 0): void {
  const o = new THREE.Mesh(circleGeo, mat(INK));
  o.position.set(x, y, z);
  o.scale.setScalar(r + LINE);
  const f = new THREE.Mesh(circleGeo, mat(color));
  f.position.set(x, y, z + 0.1);
  f.scale.setScalar(r);
  g.add(o, f);
}

function box(
  g: THREE.Group,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  rot = 0,
  z = 0,
): void {
  const o = new THREE.Mesh(quadGeo, mat(INK));
  o.position.set(x, y, z);
  o.scale.set(w + LINE * 2, h + LINE * 2, 1);
  o.rotation.z = rot;
  const f = new THREE.Mesh(quadGeo, mat(color));
  f.position.set(x, y, z + 0.1);
  f.scale.set(w, h, 1);
  f.rotation.z = rot;
  g.add(o, f);
}

function cloud(g: THREE.Group, x: number, y: number, s: number): void {
  const puffs: [number, number, number][] = [
    [x - 50 * s, y, 34 * s],
    [x + 50 * s, y - 4 * s, 30 * s],
    [x, y + 22 * s, 44 * s],
  ];
  // All outlines first, then all fills, so overlapping puffs merge into one silhouette.
  for (const [px, py, r] of puffs) circleAt(g, px, py, r + LINE, INK, 0);
  boxAt(g, x, y - 6 * s, 112 * s + LINE * 2, 28 * s + LINE * 2, INK, 0, 0);
  for (const [px, py, r] of puffs) circleAt(g, px, py, r, PALETTE.cloud, 0.1);
  boxAt(g, x, y - 6 * s, 112 * s, 28 * s, PALETTE.cloud, 0, 0.1);
}

function circleAt(g: THREE.Group, x: number, y: number, r: number, color: number, z: number): void {
  const m = new THREE.Mesh(circleGeo, mat(color));
  m.position.set(x, y, z);
  m.scale.setScalar(r);
  g.add(m);
}

function boxAt(
  g: THREE.Group,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  rot: number,
  z: number,
): void {
  const m = new THREE.Mesh(quadGeo, mat(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, 1);
  m.rotation.z = rot;
  g.add(m);
}

function mushroom(g: THREE.Group, x: number, y: number, s: number, cap: number): void {
  box(g, x, y + 24 * s, 26 * s, 48 * s, PALETTE.cream);
  disc(g, x, y + 54 * s, 44 * s, cap, 0.3);
  disc(g, x - 16 * s, y + 62 * s, 7 * s, PALETTE.cream, 0.5);
  disc(g, x + 14 * s, y + 70 * s, 6 * s, PALETTE.cream, 0.5);
}

function toyBlock(
  g: THREE.Group,
  x: number,
  y: number,
  s: number,
  color: number,
  rot: number,
): void {
  box(g, x, y + 30 * s, 56 * s, 56 * s, color, rot);
  box(g, x, y + 30 * s, 22 * s, 22 * s, PALETTE.cream, rot, 0.3);
}

function lollipopTree(g: THREE.Group, x: number, y: number, s: number, color: number): void {
  box(g, x, y + 40 * s, 12 * s, 80 * s, PALETTE.cream);
  disc(g, x, y + 100 * s, 38 * s, color, 0.3);
}

/** Thick ink line along a curve (vertical ribbon), so hill tops read as paper cutouts. */
function ribbon(pts: [number, number][], thickness: number): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach(([x, y], i) => {
    pos.push(x, y + thickness, 0, x, y - thickness, 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, mat(INK));
}

function hillLayer(
  spec: HillSpec,
  fill: number,
  depth: number,
): { group: THREE.Group; pts: [number, number][] } {
  const pts = hillCurve(spec);
  const shape = new THREE.Shape();
  const bottom = spec.base - 3000;
  shape.moveTo(pts[0]![0], bottom);
  for (const [x, y] of pts) shape.lineTo(x, y);
  shape.lineTo(pts[pts.length - 1]![0], bottom);
  shape.closePath();
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(fill));
  const line = ribbon(pts, LINE / 2);
  line.position.z = 0.2;
  body.position.z = 0;
  group.add(body, line);
  group.position.z = depth;
  return { group, pts };
}

function skyTexture(): THREE.DataTexture {
  const h = 64;
  const data = new Uint8Array(h * 4);
  const top = new THREE.Color(PALETTE.skyTop);
  const bot = new THREE.Color(PALETTE.skyBottom);
  const c = new THREE.Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < h; i++) {
    c.copy(bot).lerp(top, i / (h - 1));
    c.getRGB(rgb, THREE.SRGBColorSpace); // texture bytes are sRGB
    data.set(
      [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), 255],
      i * 4,
    );
  }
  const tex = new THREE.DataTexture(data, 1, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface Layer {
  group: THREE.Group;
  /** Camera speed fraction, x and y. */
  fx: number;
  fy: number;
}

/** Paper-cutout diorama behind the play plane: sky, clouds, far/mid/near hills and toy props. */
export class Backdrop {
  readonly group = new THREE.Group();
  private readonly layers: Layer[] = [];
  /** Camera position at which every layer sits where it was authored (map center). */
  private readonly anchorX = 1024;
  private readonly anchorY = -512;
  private readonly sky: THREE.Mesh;

  constructor(seed = 7) {
    const rng = makeRng(seed);

    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: skyTexture(), depthWrite: false }),
    );
    this.sky.position.z = -900;
    this.group.add(this.sky);

    // Clouds drift slowly (far, tiny parallax).
    const clouds = new THREE.Group();
    for (let i = 0; i < 9; i++)
      cloud(clouds, -1800 + i * 600 + rng() * 200, -80 - rng() * 260, 0.9 + rng() * 0.9);
    clouds.position.z = -800;
    this.add(clouds, 0.06, 0.04);
    this.clouds = clouds;

    const far = hillLayer(
      { seed: 1, x0: -3000, x1: 5200, base: -250, amp: 140, wavelength: 1500, step: 40 },
      PALETTE.hillFar,
      -600,
    );
    this.add(far.group, 0.2, 0.12);

    const mid = hillLayer(
      { seed: 2, x0: -2600, x1: 4800, base: -340, amp: 100, wavelength: 900, step: 30 },
      PALETTE.hillMid,
      -400,
    );
    for (let i = 0; i < 10; i++) {
      const x = -1800 + i * 520 + rng() * 200;
      const y = curveY(mid.pts, x) - 6;
      if (i % 3 === 0)
        lollipopTree(mid.group, x, y, 1 + rng() * 0.5, PALETTE.confetti[((i / 3) % 6) | 0]!);
      else if (i % 3 === 1)
        mushroom(mid.group, x, y, 0.9 + rng() * 0.5, PALETTE.confetti[(i + 2) % 6]!);
    }
    this.add(mid.group, 0.4, 0.25);

    const near = hillLayer(
      { seed: 3, x0: -2300, x1: 4400, base: -430, amp: 60, wavelength: 700, step: 24 },
      PALETTE.hillNear,
      -200,
    );
    for (let i = 0; i < 9; i++) {
      const x = -1500 + i * 480 + rng() * 240;
      const y = curveY(near.pts, x) - 6;
      if (i % 2 === 0)
        toyBlock(
          near.group,
          x,
          y,
          0.8 + rng() * 0.5,
          PALETTE.confetti[(i + 1) % 6]!,
          (rng() - 0.5) * 0.4,
        );
      else mushroom(near.group, x, y, 0.8 + rng() * 0.4, PALETTE.confetti[(i + 3) % 6]!);
    }
    this.add(near.group, 0.65, 0.5);
  }
  private clouds!: THREE.Group;
  private drift = 0;

  private add(group: THREE.Group, fx: number, fy: number): void {
    this.group.add(group);
    this.layers.push({ group, fx, fy });
  }

  /** Call every frame with the play camera (before any shake offset). */
  update(dt: number, camera: THREE.OrthographicCamera): void {
    const camX = camera.position.x;
    const camY = camera.position.y;
    // Size the sky to exactly cover the view so its gradient spans the screen at any zoom.
    this.sky.scale.set((camera.right - camera.left) * 1.1, (camera.top - camera.bottom) * 1.1, 1);
    this.drift += 6 * dt; // lazy cloud drift, world units
    // Sky is glued to the screen.
    this.sky.position.x = camX;
    this.sky.position.y = camY;
    for (const l of this.layers) {
      l.group.position.x = parallaxOffset(camX, this.anchorX, l.fx);
      l.group.position.y = parallaxOffset(camY, this.anchorY, l.fy);
    }
    this.clouds.position.x += this.drift;
  }
}
