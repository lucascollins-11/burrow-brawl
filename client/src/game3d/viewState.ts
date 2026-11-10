// What the 3D renderer and HUD draw. Deliberately independent of sim3d: an adapter turns the real
// sim state into this (and a fake driver produces it for the sandbox until sim3d lands).
// Units are voxels, y up. A critter is 6 voxels tall with a 1.5 voxel radius.

export const CRITTER_HEIGHT = 6;
export const CRITTER_RADIUS = 1.5;
export const MAX_TEAMS = 8;

export interface CritterView {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  /** Feet position. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing as a heading in degrees: 0 = +z, 90 = +x. */
  readonly headingDeg: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface ProjectileView {
  readonly id: number;
  readonly kind: "shell" | "grenade" | "bomb" | "other";
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TeamView {
  readonly index: number;
  readonly name: string;
  readonly hat: HatStyle;
}

export type HatStyle =
  "miner" | "chef" | "cone" | "pirate" | "propeller" | "crown" | "pot" | "party";

export const HAT_STYLES: readonly HatStyle[] = [
  "miner",
  "chef",
  "cone",
  "pirate",
  "propeller",
  "crown",
  "pot",
  "party",
];

export type TurnPhase = "control" | "retreat" | "settling" | "over";

export interface ViewState {
  readonly teams: readonly TeamView[];
  readonly critters: readonly CritterView[];
  readonly projectiles: readonly ProjectileView[];
  readonly activeCritterId: number | null;
  readonly activeTeam: number | null;
  readonly phase: TurnPhase;
  readonly round: number;
  /** Seconds left on the turn timer. */
  readonly timeLeft: number;
  /** Wind on the ground plane, each axis -100..100. */
  readonly wind: { readonly x: number; readonly z: number };
  /** Sea surface height in voxels. */
  readonly seaY: number;
  readonly winnerTeam: number | null;
}
