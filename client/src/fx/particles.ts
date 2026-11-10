import * as THREE from "three";
import { emitExplosion, shakeForRadius, type ExplosionSims } from "./emitters";
import { PALETTE } from "./palette";
import { ParticleSim } from "./particleSim";

const Z = 18;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

/** One InstancedMesh (plus an optional dark outline copy behind it) driven by a ParticleSim. */
class Layer {
  readonly mesh: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh | null;

  constructor(
    readonly sim: ParticleSim,
    geometry: THREE.BufferGeometry,
    outlineScale: number | null,
    private readonly scaleAt: (progress: number) => number,
  ) {
    const n = sim.x.length;
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
    this.outline = outlineScale
      ? new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: PALETTE.ink }), n)
      : null;
    if (this.outline) {
      this.outline.frustumCulled = false;
      this.outline.renderOrder = 19;
      this.outline.count = 0;
    }
    this.outlineScale = outlineScale ?? 1;
  }
  private outlineScale: number;

  add(parent: THREE.Object3D): void {
    if (this.outline) parent.add(this.outline);
    parent.add(this.mesh);
  }

  sync(): void {
    const s = this.sim;
    this.mesh.count = s.count;
    if (this.outline) this.outline.count = s.count;
    for (let i = 0; i < s.count; i++) {
      const sc = s.size[i]! * this.scaleAt(s.progress(i));
      dummy.position.set(s.x[i]!, s.y[i]!, Z);
      dummy.rotation.set(0, 0, s.rot[i]!);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, color.setHex(s.color[i]!));
      if (this.outline) {
        dummy.position.z = Z - 0.5;
        dummy.scale.setScalar(sc * this.outlineScale);
        dummy.updateMatrix();
        this.outline.setMatrixAt(i, dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.outline) this.outline.instanceMatrix.needsUpdate = true;
  }
}

/** Dirt chunks, puff rings and confetti. Cheap: three instanced draws (plus outlines), pooled. */
export class ExplosionParticles {
  readonly group = new THREE.Group();
  readonly sims: ExplosionSims = {
    chunks: new ParticleSim({ capacity: 160, gravity: 1100, drag: 0.15 }),
    puffs: new ParticleSim({ capacity: 96, gravity: -60, drag: 0.93 }),
    confetti: new ParticleSim({ capacity: 160, gravity: 700, drag: 0.5 }),
  };
  private layers: Layer[];

  constructor() {
    const chunk = new THREE.IcosahedronGeometry(1, 0);
    const puff = new THREE.CircleGeometry(1, 16);
    const quad = new THREE.PlaneGeometry(1, 0.55);
    this.layers = [
      new Layer(this.sims.chunks, chunk, 1.35, (p) => (p < 0.8 ? 1 : (1 - p) / 0.2)),
      // Puffs swell then shrink away (no per-instance alpha needed).
      new Layer(
        this.sims.puffs,
        puff,
        1.18,
        (p) => Math.sin(Math.min(1, p * 1.25) * Math.PI * 0.5 + p * 0.6) * (1 - p * p),
      ),
      new Layer(this.sims.confetti, quad, null, (p) => (p < 0.75 ? 1 : (1 - p) / 0.25)),
    ];
    this.layers.forEach((l) => l.add(this.group));
  }

  /** Returns the suggested shake trauma for this blast. */
  explode(x: number, y: number, radius: number): number {
    emitExplosion(this.sims, x, y, radius);
    return shakeForRadius(radius);
  }

  update(dt: number): void {
    for (const l of this.layers) {
      l.sim.step(dt);
      l.sync();
    }
  }
}
