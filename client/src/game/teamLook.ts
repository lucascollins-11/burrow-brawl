import type { RoomState } from "@burrow-brawl/shared/src/net";
import { TEAM_COLORS_3D as TEAM_COLORS } from "../game3d/teamColors";

/** How a sim team index is shown: name in the HUD, hat colour on the critters and HUD cards. */
export interface TeamLook {
  name: string;
  hex: number;
}

export function defaultLooks(teams: number): TeamLook[] {
  return Array.from({ length: teams }, (_, i) => ({
    name: TEAM_COLORS[i]?.name ?? `Team ${i + 1}`,
    hex: TEAM_COLORS[i]?.hex ?? 0xcccccc,
  }));
}

/** Looks for an online match: `teamIds[i]` is the room team id of sim team index i. */
export function looksFromRoom(room: RoomState | null, teamIds: readonly string[]): TeamLook[] {
  const fallback = defaultLooks(teamIds.length);
  return teamIds.map((id, i) => {
    const t = room?.teams.find((x) => x.id === id);
    if (!t) return fallback[i]!;
    const hex = Number.parseInt(t.hatColor.replace("#", ""), 16);
    return { name: t.name, hex: Number.isNaN(hex) ? fallback[i]!.hex : hex };
  });
}
