import * as THREE from "three";

interface Burst {
  readonly mesh: THREE.Mesh;
  age: number;
  readonly radius: number;
}
interface Popup {
  readonly el: HTMLElement;
  readonly pos: THREE.Vector3;
  age: number;
}

/** Explosion flash and debris, camera shake and floating damage numbers, all at 3D positions. */
export class Effects3D {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly popups: Popup[] = [];
  private readonly debris: THREE.Points;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private cursor = 0;
  private shake = 0;
  /** Camera offset to add this frame; remove it again after rendering. */
  readonly shakeOffset = new THREE.Vector3();

  constructor(private readonly container: HTMLElement) {
    const n = 600;
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9999), 3));
    this.debris = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x8b5a2b, size: 1.6, sizeAttenuation: true }),
    );
    this.debris.frustumCulled = false;
    this.group.add(this.debris);
  }

  explode(x: number, y: number, z: number, radius: number): void {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9 }),
    );
    flash.position.set(x, y, z);
    this.group.add(flash);
    this.bursts.push({ mesh: flash, age: 0, radius });
    const pos = this.debris.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 70; i++) {
      const k = this.cursor++ % this.life.length;
      pos.setXYZ(k, x, y, z);
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      const s = (0.5 + Math.random()) * radius * 3;
      this.vel.set([Math.cos(a) * s, up * s, Math.sin(a) * s], k * 3);
      this.life[k] = 1 + Math.random() * 0.8;
    }
    this.shake = Math.min(1, this.shake + radius / 14);
  }

  damage(x: number, y: number, z: number, amount: number): void {
    const el = document.createElement("div");
    el.textContent = `-${amount}`;
    el.style.cssText =
      "position:absolute;font:700 20px system-ui;color:#e85d4a;text-shadow:0 2px 0 #fff8ea,0 0 4px #fff8ea;pointer-events:none;transform:translate(-50%,-50%)";
    this.container.append(el);
    this.popups.push({ el, pos: new THREE.Vector3(x, y, z), age: 0 });
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const t = b.age / 0.45;
      b.mesh.scale.setScalar(Math.max(0.01, b.radius * (0.4 + t * 0.9)));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - t));
      if (t >= 1) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
    const pos = this.debris.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < this.life.length; k++) {
      if (this.life[k]! <= 0) continue;
      this.life[k] = this.life[k]! - dt;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1]! - 60 * dt;
      pos.setXYZ(
        k,
        pos.getX(k) + this.vel[k * 3]! * dt,
        pos.getY(k) + this.vel[k * 3 + 1]! * dt,
        pos.getZ(k) + this.vel[k * 3 + 2]! * dt,
      );
      if (this.life[k]! <= 0) pos.setXYZ(k, 0, -9999, 0);
    }
    pos.needsUpdate = true;

    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake * 1.6;
    this.shakeOffset.set(
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
    );

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.age += dt;
      const v = p.pos.clone();
      v.y += 3 + p.age * 5;
      v.project(camera);
      p.el.style.left = `${((v.x + 1) / 2) * w}px`;
      p.el.style.top = `${((1 - v.y) / 2) * h}px`;
      p.el.style.opacity = String(Math.max(0, 1 - p.age / 1.4));
      p.el.style.display = v.z > 1 ? "none" : "block";
      if (p.age > 1.4) {
        p.el.remove();
        this.popups.splice(i, 1);
      }
    }
  }
}
