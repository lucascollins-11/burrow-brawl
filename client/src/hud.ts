import type { Critter, SimEvent } from "@burrow-brawl/shared";
import { fromFixed } from "@burrow-brawl/shared";

/** Minimal debug HUD: fps, camera, zoom, cursor and terrain state. */
export class DebugHud {
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(private readonly el: HTMLElement) {}

  tick(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
    }
  }

  render(info: {
    camX: number;
    camY: number;
    viewHeight: number;
    cursorX: number;
    cursorY: number;
    carveRadius: number;
    pendingChunks: number;
    terrainHash: number;
    critter: Critter | undefined;
    tick: number;
    events: readonly SimEvent[];
  }): void {
    this.el.textContent =
      `fps    ${this.fps.toFixed(0)}\n` +
      `cam    ${info.camX.toFixed(0)}, ${info.camY.toFixed(0)}\n` +
      `zoom   ${info.viewHeight.toFixed(0)} units tall\n` +
      `cursor ${info.cursorX.toFixed(0)}, ${info.cursorY.toFixed(0)}\n` +
      `carve  r=${info.carveRadius}  hash ${info.terrainHash.toString(16)}  pending chunks ${info.pendingChunks}\n` +
      `tick ${info.tick}  critter ${info.critter ? `#${info.critter.id} ${info.critter.status} hp ${info.critter.hp} ${info.critter.grounded ? "ground" : "air"} @ ${fromFixed(info.critter.x).toFixed(1)}, ${fromFixed(info.critter.y).toFixed(1)}` : "none"}\n` +
      `events ${info.events.map((e) => e.type).join(" ")}\n` +
      `[A/D or arrows] walk  [Space] jump  [Enter] backflip  [Tab] switch critter\n` +
      `[drag] pan  [wheel] zoom  [I/J/K/L] pan\n` +
      `[right-click / ctrl+click] carve  [ ] radius  [M] wireframe`;
  }
}
