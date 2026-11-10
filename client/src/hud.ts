/** Minimal debug HUD: fps, camera position, zoom and cursor world position. */
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

  render(info: { camX: number; camY: number; viewHeight: number; cursorX: number; cursorY: number }): void {
    this.el.textContent =
      `fps    ${this.fps.toFixed(0)}\n` +
      `cam    ${info.camX.toFixed(0)}, ${info.camY.toFixed(0)}\n` +
      `zoom   ${info.viewHeight.toFixed(0)} units tall\n` +
      `cursor ${info.cursorX.toFixed(0)}, ${info.cursorY.toFixed(0)}\n` +
      `[drag] pan  [wheel] zoom  [WASD/arrows] pan`;
  }
}
