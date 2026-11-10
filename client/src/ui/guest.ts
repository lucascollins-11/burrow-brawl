const KEY = "burrowbrawl.guest";

export interface GuestSession {
  token: string;
  id: string;
  nickname: string;
  expiresAt: number;
}

/** ws(s)://host -> http(s)://host */
export function httpBase(serverUrl: string): string {
  return serverUrl.replace(/^ws/, "http").replace(/\/$/, "");
}

export function loadGuest(now = Date.now()): GuestSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GuestSession;
    return g.token && g.expiresAt > now + 60_000 ? g : null;
  } catch {
    return null;
  }
}

export function saveGuest(g: GuestSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* private mode: session just won't persist */
  }
}

const ERRORS: Record<string, string> = {
  name_invalid: "Nicknames need 2 to 16 characters.",
  rate_limited: "Slow down a little and try again.",
};

/** Get a guest JWT for a nickname, reusing a saved one when the nickname matches. */
export async function getGuest(
  serverUrl: string,
  nickname: string,
  fetchFn: typeof fetch = fetch,
): Promise<GuestSession> {
  const saved = loadGuest();
  if (saved && saved.nickname === nickname.trim()) return saved;
  let res: Response;
  try {
    res = await fetchFn(`${httpBase(serverUrl)}/api/guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
  } catch {
    throw new Error("Could not reach the game server.");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<GuestSession> & { error?: string };
  if (!res.ok || !body.token) {
    throw new Error(ERRORS[body.error ?? ""] ?? "Could not get a guest pass. Try again.");
  }
  const g: GuestSession = {
    token: body.token,
    id: body.id ?? "",
    nickname: body.nickname ?? nickname.trim(),
    expiresAt: body.expiresAt ?? Date.now() + 86_400_000,
  };
  saveGuest(g);
  return g;
}
