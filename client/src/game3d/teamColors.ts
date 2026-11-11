import type { HatStyle } from "./viewState";

/** Eight distinct team colours (hat and HUD). Index is the team slot. Chosen to stay apart for common colour blindness. */
export const TEAM_COLORS_3D = [
  { name: "Tomato", hex: 0xe85d4a },
  { name: "Sky", hex: 0x4aa3df },
  { name: "Mustard", hex: 0xf2b544 },
  { name: "Mint", hex: 0x5cc49b },
  { name: "Grape", hex: 0x8e5bc7 },
  { name: "Tangerine", hex: 0xf08a3c },
  { name: "Bubblegum", hex: 0xf08ac0 },
  { name: "Slate", hex: 0x5b6b7a },
] as const;

export function teamColor(index: number): number {
  return TEAM_COLORS_3D[((index % 8) + 8) % 8]!.hex;
}

export const cssHex = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

export const defaultHat = (index: number): HatStyle =>
  (["miner", "chef", "cone", "pirate", "propeller", "crown", "pot", "party"] as const)[
    ((index % 8) + 8) % 8
  ]!;
