import type * as THREE from "three";

export type PopupKind = "damage" | "heal" | "text";

interface Popup {
  el: HTMLDivElement;
  x: number;
  y: number;
  age: number;
  life: number;
}

const MAX_POPUPS = 24;

/** Floating "-23" style numbers: DOM text projected from world space, with outlined bubbly text. */
export class DamagePopups {
  private readonly layer: HTMLDivElement;
  private popups: Popup[] = [];

  constructor(parent: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "fx-popups";
    parent.appendChild(this.layer);
  }

  spawn(worldX: number, worldY: number, amount: number | string, kind: PopupKind = "damage"): void {
    if (this.popups.length >= MAX_POPUPS) this.remove(this.popups[0]!);
    const el = document.createElement("div");
    el.className = `fx-popup fx-${kind}`;
    el.textContent = typeof amount === "number" ? (kind === "heal" ? `+${amount}` : `-${amount}`) : amount;
    // Bigger hits look bigger.
    if (typeof amount === "number") el.style.fontSize = `${Math.min(44, 20 + amount * 0.35)}px`;
    this.layer.appendChild(el);
    // Small horizontal jitter so simultaneous hits don't overlap exactly.
    this.popups.push({ el, x: worldX + (Math.random() - 0.5) * 24, y: worldY, age: 0, life: 1.2 });
  }

  update(dt: number, camera: THREE.OrthographicCamera, width: number, height: number): void {
    for (const p of [...this.popups]) {
      p.age += dt;
      if (p.age >= p.life) {
        this.remove(p);
        continue;
      }
      const nx = (p.x - camera.position.x - (camera.left + camera.right) / 2) / ((camera.right - camera.left) / 2);
      const ny = (p.y - camera.position.y - (camera.top + camera.bottom) / 2) / ((camera.top - camera.bottom) / 2);
      const t = p.age / p.life;
      const rise = 70 * (1 - Math.pow(1 - t, 2));
      const pop = t < 0.12 ? 0.5 + (t / 0.12) * 0.8 : 1.3 - 0.3 * Math.min(1, (t - 0.12) / 0.2);
      const px = (nx * 0.5 + 0.5) * width;
      const py = (-ny * 0.5 + 0.5) * height - rise;
      p.el.style.transform = `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(${pop.toFixed(3)})`;
      p.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }

  private remove(p: Popup): void {
    p.el.remove();
    this.popups = this.popups.filter((q) => q !== p);
  }

  dispose(): void {
    this.layer.remove();
    this.popups = [];
  }
}
