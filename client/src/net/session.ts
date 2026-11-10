// Guest session: a nickname exchanged for a signed token, cached in
// localStorage so a refresh keeps the same identity (and seat).

const KEY = "bb.session.v1";

export interface Session {
  token: string;
  id: string;
  nickname: string;
  expiresAt: number;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

export function loadSession(s: KeyValueStore | null = store(), now = Date.now()): Session | null {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session>;
    if (typeof v.token !== "string" || typeof v.id !== "string" || typeof v.nickname !== "string")
      return null;
    // Refresh a day early so a long session doesn't expire mid-match.
    if (typeof v.expiresAt !== "number" || v.expiresAt - 86_400_000 < now) return null;
    return v as Session;
  } catch {
    return null;
  }
}

export function saveSession(sess: Session, s: KeyValueStore | null = store()): void {
  try {
    s?.setItem(KEY, JSON.stringify(sess));
  } catch {
    // Not fatal: the player just gets a new guest id next visit.
  }
}

export function clearSession(s: KeyValueStore | null = store()): void {
  try {
    s?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Get a guest token from the server. Throws with the server's error code. */
export async function createGuest(
  httpBase: string,
  nickname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Session> {
  const res = await fetchImpl(`${httpBase}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Session> & { error?: string };
  if (!res.ok || typeof body.token !== "string") {
    throw new Error(body.error ?? `guest request failed (${res.status})`);
  }
  return body as Session;
}

/** Cached session if its nickname matches, else a fresh guest. */
export async function ensureSession(
  httpBase: string,
  nickname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Session> {
  const cached = loadSession();
  if (cached && cached.nickname === nickname.trim()) return cached;
  const sess = await createGuest(httpBase, nickname, fetchImpl);
  saveSession(sess);
  return sess;
}
