import type { Cmd } from "@burrow-brawl/shared";
import {
  chargeAim,
  degToYaw,
  headingOf,
  moveRelativeToCamera,
  newAim,
  nudgeAim,
  type AimState,
} from "./cameraRig";
import type { Input3D } from "./input3d";

/** What a match source needs from the player's controls. */
export interface CmdInput {
  /** False when this player has no control (not their turn, settling, game over). */
  enabled: boolean;
  /** Called when a new turn starts, so held keys are sent again to the new critter. */
  newTurn(): void;
  /** Commands for one 60 Hz tick. */
  read(): Cmd[];
}

export const WEAPONS = [
  { id: "acorn-mortar", name: "Acorn Mortar" },
  { id: "fizz-grenade", name: "Fizz Grenade" },
] as const;

/** Walk headings are snapped to this many yaw steps so orbiting the camera doesn't flood commands. */
const MOVE_SNAP = 8;

/**
 * Turns raw keyboard and mouse into match commands. The sim never sees the camera: WASD is
 * converted here into an absolute walk heading, and the aim into yaw / pitch / power integers.
 *
 * WASD walks relative to the camera, Space jumps, Enter backflips, Tab (or F) enters aim mode,
 * the mouse aims, hold F to charge and release to fire, 1/2 pick a weapon, Z/X set the grenade
 * fuse, Backspace skips the turn.
 */
export class Controls3D implements CmdInput {
  enabled = true;
  /** Set by the game each frame: only the control phase may aim and fire. */
  canFire = true;
  /** Set by the game each frame: camera yaw and the active critter's heading, in degrees. */
  cameraYawDeg = 0;
  headingDeg = 0;
  aim: AimState | null = null;
  weapon = 0;
  fuseSeconds = 3;
  private queued: Cmd[] = [];
  private lastMove = -1;

  constructor(private readonly raw: Input3D) {}

  get weaponName(): string {
    const w = WEAPONS[this.weapon]!;
    return w.id === "fizz-grenade" ? `${w.name} (${this.fuseSeconds}s fuse)` : w.name;
  }

  /** Once per rendered frame. Returns the mouse movement left over for the orbit camera. */
  frame(dt: number): { dx: number; dy: number; wheel: number } {
    const inp = this.raw.consume();
    if (!this.enabled || !this.canFire) this.setAim(null);
    for (const a of inp.actions) {
      if (!this.enabled) break;
      if (a === "jump") this.queued.push({ k: "jump" });
      if (a === "backflip") this.queued.push({ k: "backflip" });
      if (a === "skip") this.queued.push({ k: "skip" });
      if (a === "weapon1") this.weapon = 0;
      if (a === "weapon2") this.weapon = 1;
      if (a === "fuseDown") this.fuseSeconds = Math.max(1, this.fuseSeconds - 1);
      if (a === "fuseUp") this.fuseSeconds = Math.min(5, this.fuseSeconds + 1);
      if (!this.canFire) continue;
      if (a === "toggleAim") this.setAim(this.aim ? null : newAim(this.headingDeg));
      if (a === "cancelAim") this.setAim(null);
      if (a === "fireDown") {
        if (!this.aim) this.setAim(newAim(this.headingDeg));
        this.aim = { ...this.aim!, charging: true, power: 0 };
      }
      if (a === "fireUp" && this.aim?.charging) this.fire(this.aim);
    }
    if (this.aim) {
      this.aim = chargeAim(nudgeAim(this.aim, inp.dx, inp.dy), dt);
      return { dx: 0, dy: 0, wheel: inp.wheel };
    }
    return { dx: inp.dx, dy: inp.dy, wheel: inp.wheel };
  }

  skip(): void {
    if (this.enabled) this.queued.push({ k: "skip" });
  }

  read(): Cmd[] {
    if (!this.enabled) {
      this.queued = [];
      this.lastMove = -1;
      return [];
    }
    const out: Cmd[] = [];
    const yaw = this.moveYaw();
    if (yaw !== this.lastMove) {
      out.push({ k: "move", yaw });
      this.lastMove = yaw;
    }
    out.push(...this.queued);
    this.queued = [];
    return out;
  }

  newTurn(): void {
    this.lastMove = -1;
    this.queued = [];
    this.setAim(null);
  }

  /** Walk heading from the held keys, or -1. Standing still while aiming. */
  private moveYaw(): number {
    if (this.aim) return -1;
    const { forward, right } = this.raw.axes();
    const dir = moveRelativeToCamera(this.cameraYawDeg, forward, right);
    if (!dir) return -1;
    return (Math.round(degToYaw(headingOf(dir)) / MOVE_SNAP) * MOVE_SNAP) % 1024;
  }

  private fire(aim: AimState): void {
    const w = WEAPONS[this.weapon]!;
    this.queued.push({
      k: "fire",
      weaponId: w.id,
      yaw: aim.yaw,
      pitch: aim.pitchDeg,
      power: Math.round(aim.power),
      ...(w.id === "fizz-grenade" ? { fuseSeconds: this.fuseSeconds } : {}),
    });
    this.setAim(null);
  }

  private setAim(aim: AimState | null): void {
    if (!!aim !== !!this.aim) this.raw.setAiming(!!aim);
    this.aim = aim;
  }
}
