import type { Cmd } from "@burrow-brawl/shared";

export type SelectedWeapon =
  | "acorn-mortar"
  | "fizz-grenade"
  | "pepper-shotgun"
  | "root-punch"
  | "jelly-mine"
  | "beehive-strike";

/** How a weapon is used: charged shots fire on release, instant ones on tap, strikes on a map click. */
export type WeaponUse = "charge" | "tap" | "click";

export const WEAPONS: ReadonlyArray<{
  id: SelectedWeapon;
  name: string;
  key: string;
  use: WeaponUse;
  hint: string;
}> = [
  { id: "acorn-mortar", name: "Acorn Mortar", key: "1", use: "charge", hint: "hold F, release" },
  { id: "fizz-grenade", name: "Fizz Grenade", key: "2", use: "charge", hint: "hold F, release" },
  {
    id: "pepper-shotgun",
    name: "Pepper Shotgun",
    key: "3",
    use: "tap",
    hint: "F fires one of two blasts",
  },
  {
    id: "root-punch",
    name: "Root Punch",
    key: "4",
    use: "tap",
    hint: "F punches the way you face",
  },
  { id: "jelly-mine", name: "Jelly Mine", key: "5", use: "tap", hint: "F drops a mine here" },
  {
    id: "beehive-strike",
    name: "Beehive Strike",
    key: "6",
    use: "click",
    hint: "click the map to call it",
  },
];

export const weaponUse = (id: SelectedWeapon): WeaponUse =>
  WEAPONS.find((w) => w.id === id)?.use ?? "charge";

const CHARGE_TICKS = 90; // 1.5 s from 0 to full power at 60 Hz

/**
 * Keyboard to Cmd translation for whoever has control.
 * A/D or arrows walk, Space jumps, Enter backflips, W/S aim, 1 to 6 pick a weapon,
 * hold F to charge and release to fire (tap F for shotgun, punch and mine; click the map for the strike), Z/X change the grenade fuse, Backspace skips the turn.
 * The picker buttons in the HUD call the same methods.
 */
export class GameInput {
  private readonly down = new Set<string>();
  private queued: Cmd[] = [];
  private lastDir: -1 | 0 | 1 = 0;

  weapon: SelectedWeapon = "acorn-mortar";
  /** Aim elevation in degrees above horizontal, 0..90, relative to the facing direction. */
  elevation = 45;
  /** 0..100 while F is held. */
  charge = 0;
  fuseSeconds = 3;
  /** Set by the game each frame: the facing of the critter being controlled. */
  facing: -1 | 1 = 1;
  /** False when nobody has control (settling, game over): input is dropped. */
  enabled = true;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        if (k === " ") this.queued.push({ k: "jump" });
        if (k === "enter") this.queued.push({ k: "backflip" });
        if (k === "backspace") this.queued.push({ k: "skip" });
        const w = WEAPONS.find((x) => x.key === k);
        if (w) this.pick(w.id);
        if (k === "f" && weaponUse(this.weapon) === "tap") this.fire({});
        if (k === "z") this.fuseSeconds = Math.max(1, this.fuseSeconds - 1);
        if (k === "x") this.fuseSeconds = Math.min(5, this.fuseSeconds + 1);
      }
      if (k === " " || k === "backspace" || k.startsWith("arrow")) e.preventDefault();
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.down.delete(k);
      if (k === "f" && this.charge > 0 && weaponUse(this.weapon) === "charge") this.release();
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.charge = 0;
    });
  }

  pick(weapon: SelectedWeapon): void {
    this.weapon = weapon;
  }

  skip(): void {
    this.queued.push({ k: "skip" });
  }

  /** Absolute aim angle in whole degrees (0 = right, 90 = up, 180 = left). */
  angle(): number {
    return this.facing === 1 ? this.elevation : 180 - this.elevation;
  }

  private release(): void {
    const power = Math.round(this.charge);
    this.charge = 0;
    this.fire({ power });
  }

  private fire(extra: { power?: number; target?: { x: number; y: number } }): void {
    this.queued.push({
      k: "fire",
      weaponId: this.weapon,
      angleDeg: this.angle(),
      power: extra.power ?? 50,
      ...(this.weapon === "fizz-grenade" ? { fuseSeconds: this.fuseSeconds } : {}),
      ...(extra.target ? { target: extra.target } : {}),
    });
  }

  /** A click on the map at sim (mask) cell coordinates. Calls a strike if that weapon is selected. */
  clickMap(x: number, y: number): void {
    if (!this.enabled || weaponUse(this.weapon) !== "click") return;
    const c = (v: number): number => Math.max(0, Math.min(16384, Math.round(v)));
    this.fire({ target: { x: c(x), y: c(y) } });
  }

  /** Commands for this tick. Held keys become a `move` only when the direction changes. */
  read(): Cmd[] {
    if (!this.enabled) {
      this.queued = [];
      this.charge = 0;
      return [];
    }
    if (this.down.has("w")) this.elevation = Math.min(90, this.elevation + 1);
    if (this.down.has("s")) this.elevation = Math.max(0, this.elevation - 1);
    if (this.down.has("f") && weaponUse(this.weapon) === "charge")
      this.charge = Math.min(100, this.charge + 100 / CHARGE_TICKS);

    const l = this.down.has("a") || this.down.has("arrowleft");
    const r = this.down.has("d") || this.down.has("arrowright");
    const dir: -1 | 0 | 1 = l === r ? 0 : l ? -1 : 1;
    const out: Cmd[] = [];
    if (dir !== this.lastDir) {
      out.push({ k: "move", dir });
      this.lastDir = dir;
    }
    out.push(...this.queued);
    this.queued = [];
    return out;
  }

  /** Called on a new turn so a held key re-sends its direction to the new critter. */
  newTurn(): void {
    this.lastDir = 0;
    this.charge = 0;
    this.queued = [];
  }
}
