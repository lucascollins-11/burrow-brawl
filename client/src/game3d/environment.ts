import * as THREE from "three";
import { windStreamer } from "./hudModel";
import { WORLD } from "./fakeWorld";

/** Sky, sun and shadows, the soda sea, a paper-cutout diorama ring and wind streamers. */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly sea: THREE.Mesh;
  private readonly bubbles: THREE.Points;
  private readonly streamers: { pole: THREE.Group; ribbon: THREE.Mesh; phase: number }[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, seaY: number) {
    scene.background = new THREE.Color(0xbfe3f5);
    scene.fog = new THREE.Fog(0xcfe9f5, 420, 1100);

    // Sky dome: pastel gradient from horizon peach to a soft blue.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x8fc9ee) },
          bottom: { value: new THREE.Color(0xffe9d2) },
        },
        vertexShader:
          "varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.6, h)), 1.0); }",
      }),
    );
    sky.name = "sky";
    this.group.add(sky);

    scene.add(new THREE.HemisphereLight(0xdff1ff, 0xd9b48a, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(WORLD.w / 2 + 120, 220, WORLD.d / 2 + 80);
    sun.target.position.set(WORLD.w / 2, 0, WORLD.d / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = WORLD.w * 0.62;
    Object.assign(sun.shadow.camera, {
      left: -half,
      right: half,
      top: half,
      bottom: -half,
      near: 10,
      far: 700,
    });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    this.group.add(sun, sun.target);
    this.sun = sun;

    // Soda sea: translucent plane with gentle waves, and bubbles rising from it.
    const seaGeo = new THREE.PlaneGeometry(2400, 2400, 80, 80);
    seaGeo.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(
      seaGeo,
      new THREE.MeshStandardMaterial({
        color: 0xff8fb8,
        transparent: true,
        opacity: 0.82,
        roughness: 0.25,
        metalness: 0.1,
      }),
    );
    this.sea.position.set(WORLD.w / 2, seaY, WORLD.d / 2);
    this.sea.receiveShadow = true;
    this.sea.name = "soda-sea";
    this.group.add(this.sea);

    const n = 220;
    const bp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++)
      bp.set(
        [
          Math.random() * 700 - 350 + WORLD.w / 2,
          seaY - Math.random() * 6,
          Math.random() * 700 - 350 + WORLD.d / 2,
        ],
        i * 3,
      );
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(bp, 3));
    this.bubbles = new THREE.Points(
      bg,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.2,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true,
      }),
    );
    this.group.add(this.bubbles);

    this.buildDiorama(seaY);
    this.buildStreamers(seaY);
    scene.add(this.group);
  }

  /** Layered paper-cutout hills in a ring around the island, each layer a flat coloured slab. */
  private buildDiorama(seaY: number): void {
    const layers = [
      { r: 760, color: 0xc9b3e8, h: 150 },
      { r: 620, color: 0xa9d9c4, h: 110 },
      { r: 500, color: 0xf6d2a8, h: 70 },
    ];
    layers.forEach((l, li) => {
      const pts: THREE.Vector2[] = [];
      const seg = 48;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const bump = 0.55 + 0.45 * Math.abs(Math.sin(a * (3 + li) + li));
        pts.push(new THREE.Vector2(Math.cos(a) * l.r, Math.sin(a) * l.r * 0 + bump * l.h));
      }
      // Hills are a ring of vertical paper cards: tall near some angles, short near others.
      const ring = new THREE.Group();
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const bump = 0.4 + 0.6 * Math.abs(Math.sin(a * (3 + li) + li * 1.7));
        const w = (2 * Math.PI * l.r) / seg + 2;
        const card = new THREE.Mesh(
          new THREE.PlaneGeometry(w, l.h * bump),
          new THREE.MeshBasicMaterial({ color: l.color, side: THREE.DoubleSide, fog: true }),
        );
        card.position.set(
          WORLD.w / 2 + Math.cos(a) * l.r,
          seaY + (l.h * bump) / 2 - 4,
          WORLD.d / 2 + Math.sin(a) * l.r,
        );
        card.rotation.y = -a + Math.PI / 2;
        ring.add(card);
      }
      ring.name = `diorama-${li}`;
      this.group.add(ring);
      void pts;
    });
  }

  /** Four poles at the island's edge with paper streamers that point and flutter with the wind. */
  private buildStreamers(seaY: number): void {
    const spots: [number, number][] = [
      [30, 30],
      [WORLD.w - 30, 30],
      [30, WORLD.d - 30],
      [WORLD.w - 30, WORLD.d - 30],
    ];
    spots.forEach(([x, z], i) => {
      const pole = new THREE.Group();
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 22, 6),
        new THREE.MeshStandardMaterial({ color: 0xf7f0e0 }),
      );
      stick.position.y = 11;
      stick.castShadow = true;
      const geo = new THREE.PlaneGeometry(14, 3, 14, 1);
      geo.translate(7, 0, 0);
      const ribbon = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: [0xe85d4a, 0xf2b544, 0x5cc49b, 0x4aa3df][i]!,
          side: THREE.DoubleSide,
          roughness: 0.9,
        }),
      );
      ribbon.position.y = 20;
      ribbon.castShadow = true;
      pole.add(stick, ribbon);
      pole.position.set(x, seaY, z); // placed on the ground by `placeStreamers`
      this.group.add(pole);
      this.streamers.push({ pole, ribbon, phase: i * 1.7 });
    });
  }

  /** Stand the streamer poles on the ground with the given height function. */
  placeStreamers(heightAt: (x: number, z: number) => number): void {
    for (const s of this.streamers)
      s.pole.position.y = heightAt(s.pole.position.x, s.pole.position.z);
  }

  /** Move the sea, bubbles and streamers. Wind is each axis -100..100. */
  update(dt: number, wind: { x: number; z: number }): void {
    this.time += dt;
    const p = this.sea.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(
        i,
        Math.sin(x * 0.02 + this.time * 1.1) * 0.7 + Math.cos(z * 0.025 + this.time * 0.9) * 0.6,
      );
    }
    p.needsUpdate = true;
    this.sea.geometry.computeVertexNormals();

    const b = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    const seaY = this.sea.position.y;
    for (let i = 0; i < b.count; i++) {
      let y = b.getY(i) + dt * (2 + (i % 5));
      if (y > seaY + 3) y = seaY - 6;
      b.setY(i, y);
    }
    b.needsUpdate = true;

    const w = windStreamer(wind);
    for (const s of this.streamers) {
      s.ribbon.rotation.y = (w.headingDeg * Math.PI) / 180 - Math.PI / 2;
      const g = s.ribbon.geometry.attributes.position as THREE.BufferAttribute;
      const amp = 0.4 + w.strength * 2.4;
      for (let i = 0; i < g.count; i++) {
        const x = g.getX(i);
        const droop = (1 - w.strength) * x * 0.45; // calm air lets the paper hang
        g.setZ(i, Math.sin(x * 0.7 - this.time * (3 + w.strength * 9) + s.phase) * amp * (x / 14));
        g.setY(i, g.getY(i) > 0 ? 1.5 - droop : -1.5 - droop);
      }
      g.needsUpdate = true;
    }
  }
}
