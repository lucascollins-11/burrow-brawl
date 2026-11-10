import type { Member, RoomState, TeamSetup } from "@burrow-brawl/shared/src/net";
import { MAX_MEMBERS, MIN_TEAMS } from "@burrow-brawl/shared/src/net";

export type Screen = "title" | "connecting" | "lobby" | "starting" | "results";

/** End-of-match info. `winnerTeamId` null means a draw. Mirrors protocol `match.end` (stats later). */
export interface MatchResult {
  winnerTeamId: string | null;
  /** True when we only know the room is in its results phase (e.g. we reconnected and missed `match.end`). */
  unknown?: boolean;
}

export interface UiState {
  screen: Screen;
  you: { id: string; nickname: string } | null;
  room: RoomState | null;
  error: string | null;
  result: MatchResult | null;
}

export const initialState: UiState = {
  screen: "title",
  you: null,
  room: null,
  error: null,
  result: null,
};

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

/** Friendly text for a protocol error code (falls back to the server's message). */
export function errorText(code: string, fallback: string): string {
  return ERROR_TEXT[code] ?? fallback;
}

/** A room snapshot arrived (create/join reply or any later change). */
export function applyRoom(
  state: UiState,
  room: RoomState,
  me?: { id: string; nickname: string },
): UiState {
  const you = me ?? state.you;
  if (state.room && state.room.code === room.code && room.version < state.room.version)
    return state;
  const base = { ...state, you, room };
  if (room.phase === "lobby") return { ...base, screen: "lobby", error: null, result: null };
  // Keep the results overlay up while the room sits in its results phase. If we never saw
  // `match.end` (we reconnected into the results phase) show a generic "match over".
  if (room.phase === "results")
    return {
      ...base,
      screen: "results",
      result: state.result ?? { winnerTeamId: null, unknown: true },
    };
  return { ...base, screen: "starting" };
}

export function applyRoomLeft(state: UiState, reason: "left" | "kicked" | "closed"): UiState {
  const error =
    reason === "kicked"
      ? "You were removed from the room."
      : reason === "closed"
        ? "The room was closed."
        : null;
  return { ...state, screen: "title", room: null, result: null, error };
}

export function withError(state: UiState, error: string | null): UiState {
  return { ...state, error };
}

/** The match ended: show the results overlay. */
export function withResult(state: UiState, result: MatchResult): UiState {
  return { ...state, screen: "results", result };
}

/** Back to lobby after a match (rematch): clear the result and show the lobby again. */
export function backToLobby(state: UiState): UiState {
  return { ...state, screen: state.room ? "lobby" : "title", result: null };
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
