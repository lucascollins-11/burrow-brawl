import * as THREE from 'three';

/** Pan/zoom controller for an orthographic camera looking at the z=0 play plane. */
export class PanZoomCamera {
  readonly camera: THREE.OrthographicCamera;
  /** World units visible vertically. */
  viewHeight: number;
  readonly minViewHeight = 100;
  readonly maxViewHeight = 4000;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly keys = new Set<string>();

  constructor(private readonly el: HTMLElement, viewHeight = 1200) {
    this.viewHeight = viewHeight;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.camera.position.set(1024, -512, 1000);
    this.resize();
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const aspect = this.el.clientWidth / Math.max(1, this.el.clientHeight);
    const h = this.viewHeight / 2;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  private worldPerPixel(): number {
    return this.viewHeight / Math.max(1, this.el.clientHeight);
  }

  /** Convert a screen point (px, relative to element) to a point on the z=0 plane. */
  screenToWorld(px: number, py: number): THREE.Vector2 {
    const nx = (px / this.el.clientWidth) * 2 - 1;
    const ny = -((py / this.el.clientHeight) * 2 - 1);
    const v = new THREE.Vector3(nx, ny, 0).unproject(this.camera);
    return new THREE.Vector2(v.x, v.y);
  }

  update(dt: number): void {
    const speed = this.viewHeight * 0.8 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= 1;
    this.camera.position.x += dx * speed;
    this.camera.position.y += dy * speed;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 1 && e.button !== 2 && e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const k = this.worldPerPixel();
    this.camera.position.x -= (e.clientX - this.lastX) * k;
    this.camera.position.y += (e.clientY - this.lastY) * k;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const before = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const factor = Math.exp(e.deltaY * 0.001);
    this.viewHeight = Math.min(this.maxViewHeight, Math.max(this.minViewHeight, this.viewHeight * factor));
    this.resize();
    // Keep the point under the cursor fixed.
    const after = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    this.camera.position.x += before.x - after.x;
    this.camera.position.y += before.y - after.y;
  };
}
