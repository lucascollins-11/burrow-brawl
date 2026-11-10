import * as THREE from "three";
import { PALETTE } from "./palette";
import { makeRng } from "./rng";

const VERT = /* glsl */ `
uniform float uTime;
varying float vDepth;
varying float vTop;
void main() {
  vec3 p = position;
  float top = step(0.5, uv.y);
  float wave = sin(p.x * 0.012 + uTime * 1.6) * 7.0 + sin(p.x * 0.031 - uTime * 2.3) * 3.5;
  p.y += wave * top;
  vDepth = 1.0 - uv.y;
  vTop = top;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uTopColor;
uniform vec3 uDeepColor;
uniform vec3 uInk;
uniform float uAlpha;
uniform float uBand;
varying float vDepth;
varying float vTop;
void main() {
  vec3 c = mix(uTopColor, uDeepColor, smoothstep(0.0, 0.5, vDepth));
  // Thick ink line plus a lighter foam strip along the surface.
  float line = 1.0 - smoothstep(uBand * 0.8, uBand, vDepth);
  float foam = 1.0 - smoothstep(uBand, uBand * 2.4, vDepth);
  c = mix(c, vec3(1.0, 0.93, 0.96), foam * 0.7);
  c = mix(c, uInk, line);
  gl_FragColor = vec4(c, mix(uAlpha, 1.0, line));
}`;

const BUBBLES = 48;
const WIDTH = 7000;
const DEPTH = 600;
const X0 = -2500;

/** Animated soda pit: wavy surface, ink outline, and rising bubbles that pop at the surface. */
export class Soda {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly fill: THREE.InstancedMesh;
  private readonly ring: THREE.InstancedMesh;
  private readonly seeds: Float32Array; // x(0..1), phase, speed, size
  private level = -1024;
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(z = 15) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTopColor: { value: new THREE.Color(PALETTE.sodaTop) },
        uDeepColor: { value: new THREE.Color(PALETTE.sodaDeep) },
        uInk: { value: new THREE.Color(PALETTE.ink) },
        uAlpha: { value: 0.82 },
        uBand: { value: 14 / DEPTH },
      },
    });
    // Plane is built with its top edge at y=0 so `level` is the surface height.
    const geo = new THREE.PlaneGeometry(WIDTH, DEPTH, 160, 1);
    geo.translate(WIDTH / 2 + X0, -DEPTH / 2, 0);
    const body = new THREE.Mesh(geo, this.material);
    body.frustumCulled = false;
    body.position.z = z;
    body.renderOrder = 10;
    this.group.add(body);
    this.body = body;

    const circle = new THREE.CircleGeometry(1, 14);
    this.ring = new THREE.InstancedMesh(
      circle,
      new THREE.MeshBasicMaterial({ color: PALETTE.ink }),
      BUBBLES,
    );
    this.fill = new THREE.InstancedMesh(
      circle,
      new THREE.MeshBasicMaterial({ color: PALETTE.bubble }),
      BUBBLES,
    );
    for (const m of [this.ring, this.fill]) {
      m.frustumCulled = false;
      m.renderOrder = 11;
      m.position.z = z + 0.5;
      this.group.add(m);
    }
    const rng = makeRng(99);
    this.seeds = new Float32Array(BUBBLES * 4);
    for (let i = 0; i < BUBBLES; i++) {
      this.seeds[i * 4] = rng();
      this.seeds[i * 4 + 1] = rng();
      this.seeds[i * 4 + 2] = 0.08 + rng() * 0.12;
      this.seeds[i * 4 + 3] = 4 + rng() * 9;
    }
    this.setLevel(this.level);
    this.update(0);
  }
  private readonly body: THREE.Mesh;

  /** World y of the soda surface (e.g. `-sim.waterY`). Raise it each turn in sudden death. */
  setLevel(worldY: number): void {
    this.level = worldY;
    this.body.position.y = worldY;
    this.ring.position.y = worldY;
    this.fill.position.y = worldY;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
    for (let i = 0; i < BUBBLES; i++) {
      const s = this.seeds;
      const t = (s[i * 4 + 1]! + this.time * s[i * 4 + 2]!) % 1; // 0 deep .. 1 surface
      const x = X0 + s[i * 4]! * WIDTH + Math.sin(this.time * 2 + i) * 4;
      const y = -DEPTH * 0.9 * (1 - t) + 4;
      // Grow slightly, then pop (shrink to nothing) on reaching the surface.
      const pop = t > 0.93 ? (1 - t) / 0.07 : 1;
      const r = s[i * 4 + 3]! * (0.6 + 0.4 * t) * pop;
      this.dummy.position.set(x, y, 0);
      this.dummy.scale.setScalar(r + 2.5 * pop);
      this.dummy.updateMatrix();
      this.ring.setMatrixAt(i, this.dummy.matrix);
      this.dummy.scale.setScalar(Math.max(0.01, r));
      this.dummy.updateMatrix();
      this.fill.setMatrixAt(i, this.dummy.matrix);
    }
    this.ring.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
  }
}
