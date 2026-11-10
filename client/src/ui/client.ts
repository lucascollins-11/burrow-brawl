import type { GameClient } from "../net";

/** Statuses the UI shows. "waking" is emitted by the net layer when the free-tier server is cold-starting. */
export type UiStatus = "connecting" | "waking" | "open" | "reconnecting" | "closed";

/**
 * The slice of `GameClient` (client/src/net) the lobby UI uses, so tests and `?mock` can swap in a fake.
 * `rematch` is optional until the protocol has a back-to-lobby path.
 */
export type LobbyClient = Pick<
  GameClient,
  | "room"
  | "me"
  | "isHost"
  | "on"
  | "createRoom"
  | "joinRoom"
  | "leaveRoom"
  | "setTeam"
  | "editTeam"
  | "addTeam"
  | "removeTeam"
  | "setSettings"
  | "setReady"
  | "kick"
  | "startMatch"
  | "close"
> & { rematch?: () => Promise<void> };
