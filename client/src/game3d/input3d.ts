/** Raw input for the 3D game: held keys, mouse drag/wheel deltas and one-shot actions. Pure state; the game reads it each frame. */
export class Input3D {
  private readonly down = new Set<string>();
  dragDx = 0;
  dragDy = 0;
  wheel = 0;
  private readonly actions: string[] = [];
  aiming = false;
  /** False while a menu is on screen: keys are left alone (Tab, typing) and nothing is queued. */
  active = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly off: (() => void)[] = [];

  constructor(private readonly canvas: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(
      t: K,
      f: (e: WindowEventMap[K]) => void,
      target: EventTarget = window,
    ) => {
      target.addEventListener(t, f as EventListener);
      this.off.push(() => target.removeEventListener(t, f as EventListener));
    };
    on("keydown", (e) => {
      if (!this.active || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        if (k === "z") this.actions.push("fuseDown");
        if (k === "x") this.actions.push("fuseUp");
        if (k === "tab") {
          e.preventDefault();
          this.actions.push("toggleAim");
        }
        if (k === " ") this.actions.push("jump");
        if (k === "enter") this.actions.push("backflip");
        if (k === "backspace") this.actions.push("skip");
        if (k === "escape") this.actions.push("cancelAim");
        if (k >= "1" && k <= "9") this.actions.push(`weapon${k}`);
        if (k === "f") this.actions.push("fireDown");
      }
      if (k === " " || k === "backspace" || k.startsWith("arrow")) e.preventDefault();
      this.down.add(k);
    });
    on("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.down.delete(k);
      if (k === "f" && this.active) this.actions.push("fireUp");
    });
    on("blur", () => this.down.clear());
    on(
      "pointerdown",
      (e) => {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      },
      canvas,
    );
    on("pointerup", () => (this.dragging = false));
    on("pointermove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.dragDx += e.movementX;
        this.dragDy += e.movementY;
      } else if (this.dragging) {
        this.dragDx += e.clientX - this.lastX;
        this.dragDy += e.clientY - this.lastY;
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    on(
      "wheel",
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      canvas,
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  held(k: string): boolean {
    return this.down.has(k);
  }

  /** WASD / arrows as -1, 0, 1 axes: forward (W) and right (D). */
  axes(): { forward: number; right: number } {
    const f =
      (this.held("w") || this.held("arrowup") ? 1 : 0) -
      (this.held("s") || this.held("arrowdown") ? 1 : 0);
    const r =
      (this.held("d") || this.held("arrowright") ? 1 : 0) -
      (this.held("a") || this.held("arrowleft") ? 1 : 0);
    return { forward: f, right: r };
  }

  /** Take and clear the mouse deltas and one-shot actions accumulated since the last call. */
  consume(): { dx: number; dy: number; wheel: number; actions: string[] } {
    const out = {
      dx: this.dragDx,
      dy: this.dragDy,
      wheel: this.wheel,
      actions: this.actions.splice(0),
    };
    this.dragDx = this.dragDy = this.wheel = 0;
    return out;
  }

  /** Aim mode wants a locked pointer so the crosshair turns without leaving the window. */
  setAiming(on: boolean): void {
    this.aiming = on;
    try {
      if (on) {
        const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    } catch {
      // Pointer lock can be refused (iframes, headless); dragging still works.
    }
  }

  dispose(): void {
    this.off.forEach((f) => f());
  }
}
