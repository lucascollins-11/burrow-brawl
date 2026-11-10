import type { CritterInput } from "@burrow-brawl/shared";

/** Keyboard state for the active critter: A/D or arrows walk, Space jumps, Enter backflips. */
export class SimInput {
  private readonly down = new Set<string>();
  private jumpQueued = false;
  private backflipQueued = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        if (k === " ") this.jumpQueued = true;
        if (k === "enter") this.backflipQueued = true;
      }
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.down.clear());
  }

  /** Build this tick's input. Jump/backflip presses are consumed once so they fire a single launch. */
  read(critterId: number): CritterInput {
    const l = this.down.has("a") || this.down.has("arrowleft");
    const r = this.down.has("d") || this.down.has("arrowright");
    const input: CritterInput = {
      critterId,
      move: l === r ? 0 : l ? -1 : 1,
      jump: this.jumpQueued,
      backflip: this.backflipQueued,
    };
    this.jumpQueued = false;
    this.backflipQueued = false;
    return input;
  }
}
