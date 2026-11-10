// One row per weapon for the online determinism harness (weapons.e2e.test.ts).
// Each case is fired once over real sockets; the test asserts the expected
// events happened and every client's state hash equals the server's.
//
// To cover a new weapon, add one line:
//   { weapon: "pepper-shotgun", angleDeg: 20, power: 100, expect: ["fired", "damage"] },
// angleDeg is mirrored automatically so the shot heads toward the map center.

import type { Cmd, SimEvent, WeaponId } from "@burrow-brawl/shared";

export interface WeaponCase {
  weapon: WeaponId;
  /** Whole degrees, 0 = right, 90 = up, aimed as if the shooter were left of center. */
  angleDeg: number;
  power: number;
  fuseSeconds?: number;
  /** Event types that must appear in the turn (in any order). */
  expect: SimEvent["type"][];
  /** Commands sent before the shot (walk, jump), one batch per entry. */
  before?: Cmd[][];
  /** Click point in mask cells for click-targeted weapons. Not mirrored. */
  target?: { x: number; y: number };
  /** Send the fire command this many times, with runner.advance(1) between (default 1). */
  repeat?: number;
  /** Test name suffix when one weapon has several cases. */
  label?: string;
}

export const WEAPON_CASES: WeaponCase[] = [
  { weapon: "acorn-mortar", angleDeg: 55, power: 35, expect: ["fired", "explosion"] },
  { weapon: "acorn-mortar", angleDeg: 80, power: 100, expect: ["fired"], label: "high lob" },
  {
    weapon: "fizz-grenade",
    angleDeg: 60,
    power: 30,
    fuseSeconds: 3,
    expect: ["fired", "explosion"],
  },
  {
    weapon: "fizz-grenade",
    angleDeg: 45,
    power: 60,
    fuseSeconds: 5,
    expect: ["fired", "explosion"],
    before: [[{ k: "jump" }]],
    label: "5 s fuse after a jump",
  },
  // S12 arsenal. The shotgun owes two blasts; only the second ends the turn.
  {
    weapon: "pepper-shotgun",
    angleDeg: 5,
    power: 50,
    repeat: 2,
    expect: ["shot", "fired"],
  },
  { weapon: "root-punch", angleDeg: 0, power: 0, expect: ["punched", "fired"] },
  { weapon: "jelly-mine", angleDeg: 0, power: 0, expect: ["minePlaced", "fired"] },
  {
    weapon: "beehive-strike",
    angleDeg: 0,
    power: 0,
    target: { x: 1024, y: 500 },
    expect: ["strikeCalled", "fired", "explosion"],
  },
];
