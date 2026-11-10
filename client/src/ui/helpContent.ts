import { WEAPONS } from "../game/input";

export interface ControlRow {
  /** Keys as shown to the player. */
  keys: string[];
  action: string;
  /** Raw `KeyboardEvent.key` values (lowercase) this row relies on; checked against game/input.ts by a test. */
  bound: string[];
}

export interface ControlGroup {
  title: string;
  rows: ControlRow[];
}

/**
 * Controls as bound in client/src/game/input.ts (the single source of truth) and
 * client/src/camera.ts. A test checks every `bound` key still appears in input.ts, so
 * this list can't silently drift when the bindings change.
 */
export const CONTROLS: ControlGroup[] = [
  {
    title: "Your turn",
    rows: [
      {
        keys: ["A", "D"],
        action: "Walk left / right (arrow keys work too)",
        bound: ["a", "d", "arrowleft", "arrowright"],
      },
      { keys: ["Space"], action: "Jump forward", bound: [" "] },
      { keys: ["Enter"], action: "Backflip", bound: ["enter"] },
      { keys: ["W", "S"], action: "Aim up / down", bound: ["w", "s"] },
      { keys: ["Hold F"], action: "Charge the shot, release to fire", bound: ["f"] },
      ...WEAPONS.map((w) => ({ keys: [w.key], action: `Pick ${w.name}`, bound: [w.key] })),
      { keys: ["Z", "X"], action: "Shorter / longer grenade fuse (1 to 5 s)", bound: ["z", "x"] },
      { keys: ["Backspace"], action: "Skip your turn", bound: ["backspace"] },
    ],
  },
  {
    title: "Camera",
    rows: [
      { keys: ["Drag"], action: "Pan the view", bound: [] },
      { keys: ["Mouse wheel"], action: "Zoom in / out", bound: [] },
      { keys: ["I", "J", "K", "L"], action: "Pan with the keyboard", bound: ["i", "j", "k", "l"] },
    ],
  },
  {
    title: "Anywhere",
    rows: [
      { keys: ["H"], action: "Show or hide this help", bound: [] },
      { keys: ["Esc"], action: "Close this window", bound: [] },
    ],
  },
];

export const TIPS: string[] = [
  "Wind pushes the Acorn Mortar, so watch the arrow before you fire.",
  "Fizz Grenades bounce: set the fuse, then lob them over walls.",
  "Falling into the soda knocks a Molekin out, so mind the edge.",
  "Last team with a Molekin standing wins.",
];
