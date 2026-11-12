// One row per weapon for the online determinism harness (weapons.e2e.test.ts).
// Each case is fired once over real sockets; the test asserts the expected
// events happened and every client's state hash equals the server's.
//
// To cover a new weapon, add one line:
//   { weapon: "pepper-shotgun", pitch: 20, power: 100, expect: ["fired", "damage"] },
// The shot is always aimed toward the map center; the case only picks the pitch.

import type { Cmd, SimEvent, WeaponId } from "@burrow-brawl/shared";

export interface WeaponCase {
  weapon: WeaponId;
  /** Whole degrees above level. */
  pitch: number;
  power: number;
  fuseSeconds?: number;
  /** Event types that must appear in the turn (in any order). */
  expect: SimEvent["type"][];
  /** Commands sent before the shot (walk, jump), one batch per entry. */
  before?: Cmd[][];
  /** Test name suffix when one weapon has several cases. */
  label?: string;
  /** Aim at a target voxel: the map centre on the surface (for strikes). */
  target?: "center";
  /** Send `trigger` this many ticks after the shot (cluster weapons). */
  triggerAfter?: number;
}

export const WEAPON_CASES: WeaponCase[] = [
  { weapon: "acorn-mortar", pitch: 55, power: 35, expect: ["fired", "explosion"] },
  { weapon: "acorn-mortar", pitch: 80, power: 100, expect: ["fired"], label: "high lob" },
  {
    weapon: "fizz-grenade",
    pitch: 60,
    power: 30,
    fuseSeconds: 3,
    expect: ["fired", "explosion"],
  },
  {
    weapon: "fizz-grenade",
    pitch: 45,
    power: 60,
    fuseSeconds: 5,
    expect: ["fired", "explosion"],
    before: [[{ k: "jump" }]],
    label: "5 s fuse after a jump",
  },
  { weapon: "pinecone-popper", pitch: 55, power: 35, expect: ["fired", "explosion"] },
  {
    weapon: "pinecone-popper",
    pitch: 70,
    power: 50,
    triggerAfter: 24,
    expect: ["fired", "explosion"],
    label: "popped mid-air",
  },
  { weapon: "hopper-ball", pitch: 50, power: 30, expect: ["fired", "bounced", "explosion"] },
  {
    weapon: "beehive-strike",
    pitch: 0,
    power: 0,
    target: "center",
    expect: ["fired", "explosion"],
  },
];
