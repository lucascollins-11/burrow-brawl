import type { CritterInput, FireCommand } from "@burrow-brawl/shared";

export type SelectedWeapon = "acorn-mortar" | "fizz-grenade";

const CHARGE_TICKS = 90; // 1.5 s from 0 to full power at 60 Hz

/**
 * Keyboard state for the active critter.
 * A/D or arrows walk, Space jumps, Enter backflips, W/S aim, 1/2 pick a weapon,
 * hold F to charge and release to fire, Z/X change the grenade fuse.
 */
export class SimInput {
  private readonly down = new Set<string>();
  private jumpQueued = false;
  private backflipQueued = false;
  private fireQueued: FireCommand | null = null;

  weapon: SelectedWeapon = "acorn-mortar";
  /** Aim elevation in degrees above horizontal, 0..90, relative to the facing direction. */
  elevation = 45;
  /** 0..100 while F is held. */
  charge = 0;
  fuseSeconds = 3;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        if (k === " ") this.jumpQueued = true;
        if (k === "enter") this.backflipQueued = true;
        if (k === "1") this.weapon = "acorn-mortar";
        if (k === "2") this.weapon = "fizz-grenade";
        if (k === "z") this.fuseSeconds = Math.max(1, this.fuseSeconds - 1);
        if (k === "x") this.fuseSeconds = Math.min(5, this.fuseSeconds + 1);
      }
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.down.delete(k);
      if (k === "f" && this.charge > 0) this.releaseFire();
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.charge = 0;
    });
  }

  /** Absolute aim angle in whole degrees (0 = right, 90 = up, 180 = left) for the given facing. */
  angleFor(facing: -1 | 1): number {
    return facing === 1 ? this.elevation : 180 - this.elevation;
  }

  private facing: -1 | 1 = 1;

  private releaseFire(): void {
    this.fireQueued = {
      weaponId: this.weapon,
      angleDeg: this.angleFor(this.facing),
      power: Math.round(this.charge),
      ...(this.weapon === "fizz-grenade" ? { fuseSeconds: this.fuseSeconds } : {}),
    };
    this.charge = 0;
  }

  /** Build this tick's input. One-shot presses are consumed so they fire a single time. */
  read(critterId: number, facing: -1 | 1): CritterInput {
    this.facing = facing;
    if (this.down.has("w")) this.elevation = Math.min(90, this.elevation + 1);
    if (this.down.has("s")) this.elevation = Math.max(0, this.elevation - 1);
    if (this.down.has("f")) this.charge = Math.min(100, this.charge + 100 / CHARGE_TICKS);

    const l = this.down.has("a") || this.down.has("arrowleft");
    const r = this.down.has("d") || this.down.has("arrowright");
    const input: CritterInput = {
      critterId,
      move: l === r ? 0 : l ? -1 : 1,
      jump: this.jumpQueued,
      backflip: this.backflipQueued,
      ...(this.fireQueued ? { fire: this.fireQueued } : {}),
    };
    this.jumpQueued = false;
    this.backflipQueued = false;
    this.fireQueued = null;
    return input;
  }
}
