import { normalizeRoomCode } from "@burrow-brawl/shared/src/net";

/** `/r/K7QX2` -> "K7QX2", anything else -> null. */
export function roomCodeFromPath(pathname: string): string | null {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname);
  return m ? normalizeRoomCode(decodeURIComponent(m[1]!)) : null;
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin}/r/${code}`;
}
