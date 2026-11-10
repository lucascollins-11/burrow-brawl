import { fromFixed, type SimEvent, type SimState } from "@burrow-brawl/shared";
import type * as THREE from "three";
import { Backdrop } from "./backdrop";
import { DamagePopups, type PopupKind } from "./damageNumbers";
import { ExplosionParticles } from "./particles";
import { ScreenShake } from "./shake";
import { Soda } from "./soda";
import "./fx.css";

export { ScreenShake } from "./shake";
export { Backdrop } from "./backdrop";
export { Soda } from "./soda";
export { ExplosionParticles } from "./particles";
export { DamagePopups } from "./damageNumbers";

export interface FxOptions {
  /** World y of the soda surface at the start (e.g. `-sim.waterY`). */
  sodaLevel: number;
  /** Element the damage popups are added to (the canvas container). */
  container: HTMLElement;
}

/**
 * Everything visual that is not the terrain or the critters. The scene owner wires it in with:
 *
 *   const fx = new FxSystem(scene, camera, { sodaLevel: -sim.waterY, container });
 *   // each frame, instead of renderer.render(...):
 *   fx.frame(dt, renderer, scene, camera);
 *   // when the sim reports things:
 *   fx.explode(x, y, radius);  fx.damage(x, y, 23);  fx.setSodaLevel(-state.waterY);
 *
 * All coordinates are world units with y up (sim y is negated, like the rest of the client).
 */
export class FxSystem {
  readonly backdrop = new Backdrop();
  readonly soda = new Soda();
  readonly particles = new ExplosionParticles();
  readonly shake = new ScreenShake();
  readonly popups: DamagePopups;
  private readonly container: HTMLElement;

  constructor(scene: THREE.Scene, _camera: THREE.OrthographicCamera, opts: FxOptions) {
    this.container = opts.container;
    // Replace the placeholder cutouts from the skeleton scene.
    for (let i = 0; scene.getObjectByName(`backdrop-${i}`); i++) {
      const old = scene.getObjectByName(`backdrop-${i}`);
      if (old) scene.remove(old);
    }
    scene.background = null; // the sky plane replaces the flat color
    scene.add(this.backdrop.group, this.soda.group, this.particles.group);
    this.soda.setLevel(opts.sodaLevel);
    this.popups = new DamagePopups(opts.container);
  }

  explode(x: number, y: number, radius: number): void {
    this.shake.add(this.particles.explode(x, y, radius));
  }

  /** Floating "-23" above a critter. */
  damage(x: number, y: number, amount: number | string, kind: PopupKind = "damage"): void {
    this.popups.spawn(x, y, amount, kind);
  }

  /**
   * Turn sim events into effects: explosions burst and shake, damage pops a number over the critter.
   * Pass the state the events were produced from (for critter positions).
   */
  onSimEvents(events: readonly SimEvent[], state: SimState): void {
    for (const e of events) {
      if (e.type === "explosion") {
        this.explode(e.x, -e.y, e.radius); // sim y is down, world y is up
      } else if (e.type === "shot") {
        // A puff where the blast ended; bigger if it dug into the ground.
        this.explode(e.x1, -e.y1, e.carved > 0 || e.hitCritterId !== null ? 10 : 4);
      } else if (e.type === "punched" && e.targetId !== null) {
        const t = state.critters.find((k) => k.id === e.targetId);
        if (t) this.explode(fromFixed(t.x), -fromFixed(t.y) + 10, 18);
        this.addShake(0.25);
      } else if (e.type === "mineArmed") {
        const m = state.mines.find((k) => k.id === e.mineId);
        if (m) this.damage(m.x, -m.y + 16, "armed", "text");
      } else if (e.type === "damage") {
        const c = state.critters.find((k) => k.id === e.critterId);
        if (c) this.damage(fromFixed(c.x), -fromFixed(c.y) + 40, e.amount);
      } else if (e.type === "landed" && e.fallDistance > 80) {
        this.addShake(Math.min(0.3, e.fallDistance / 1000));
      }
    }
  }

  /** Extra shake for non-explosion thuds (0..1). */
  addShake(amount: number): void {
    this.shake.add(amount);
  }

  setSodaLevel(worldY: number): void {
    this.soda.setLevel(worldY);
  }

  /** Update all effects and render the scene with the shake applied (replaces `renderer.render`). */
  frame(
    dt: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.OrthographicCamera,
  ): void {
    this.backdrop.update(dt, camera);
    this.soda.update(dt);
    this.particles.update(dt);
    this.shake.update(dt);
    this.popups.update(dt, camera, this.container.clientWidth, this.container.clientHeight);
    camera.position.x += this.shake.offsetX;
    camera.position.y += this.shake.offsetY;
    renderer.render(scene, camera);
    camera.position.x -= this.shake.offsetX;
    camera.position.y -= this.shake.offsetY;
  }
}
