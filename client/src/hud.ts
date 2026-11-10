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
  }): void {
    this.el.textContent =
      `fps    ${this.fps.toFixed(0)}\n` +
      `cam    ${info.camX.toFixed(0)}, ${info.camY.toFixed(0)}\n` +
      `zoom   ${info.viewHeight.toFixed(0)} units tall\n` +
      `cursor ${info.cursorX.toFixed(0)}, ${info.cursorY.toFixed(0)}\n` +
      `carve  r=${info.carveRadius}  hash ${info.terrainHash.toString(16)}  pending chunks ${info.pendingChunks}\n` +
      `[drag] pan  [wheel] zoom  [WASD/arrows] pan\n` +
      `[right-click / ctrl+click] carve  [ ] radius  [M] wireframe`;
  }
}
