import type { Member, RoomState, ServerMessage, TeamSetup } from "@burrow-brawl/shared/src/net";
import { MAX_MEMBERS, MIN_TEAMS } from "@burrow-brawl/shared/src/net";

export type Screen = "title" | "connecting" | "lobby" | "starting";

export interface UiState {
  screen: Screen;
  you: { id: string; nickname: string } | null;
  room: RoomState | null;
  error: string | null;
}

export const initialState: UiState = { screen: "title", you: null, room: null, error: null };

const ERROR_TEXT: Record<string, string> = {
  room_not_found: "No room with that code. Check the letters and try again.",
  room_full: "That room is full (4 players max).",
  match_in_progress: "That match already started.",
  team_taken: "Somebody grabbed that team first.",
  not_host: "Only the host can do that.",
  version_mismatch: "The game was updated. Refresh the page.",
  unauthorized: "Your guest pass expired. Pick a nickname again.",
  rate_limited: "Too many tries. Wait a moment.",
};

export function reduce(state: UiState, msg: ServerMessage): UiState {
  switch (msg.t) {
    case "welcome":
      return { ...state, you: msg.you };
    case "room.joined":
      return { ...state, screen: "lobby", room: msg.room, error: null };
    case "room.update": {
      if (state.room && msg.room.version < state.room.version) return state;
      const screen = msg.room.phase === "lobby" ? "lobby" : "starting";
      return { ...state, screen, room: msg.room };
    }
    case "room.left":
      return {
        ...state,
        screen: "title",
        room: null,
        error: msg.reason === "kicked" ? "You were removed from the room." : null,
      };
    case "error":
      return { ...state, error: ERROR_TEXT[msg.code] ?? msg.message };
    default:
      return state;
  }
}

export const isHost = (s: UiState): boolean => !!s.room && s.room.hostId === s.you?.id;
export const myMember = (s: UiState): Member | undefined =>
  s.room?.members.find((m) => m.id === s.you?.id);
export const myTeam = (s: UiState): TeamSetup | undefined => {
  const tid = myMember(s)?.teamId;
  return s.room?.teams.find((t) => t.id === tid);
};

/** Why the host can't start yet, or null if they can. */
export function startBlocker(room: RoomState): string | null {
  const playing = room.teams.filter((t) => t.controllerId !== null);
  if (playing.length < MIN_TEAMS) return "Need at least 2 teams with a player.";
  if (room.members.some((m) => m.teamId === null)) return "Everyone needs to pick a team.";
  if (room.members.some((m) => !m.ready)) return "Waiting for everyone to be ready.";
  return null;
}

export const roomIsFull = (room: RoomState): boolean => room.members.length >= MAX_MEMBERS;
