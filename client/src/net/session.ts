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

/** The server answered with a refusal (bad nickname, rate limit): retrying won't help. */
export class GuestRefused extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "GuestRefused";
  }
}

/** Get a guest token from the server. Throws GuestRefused on a 4xx, other errors on network trouble. */
export async function createGuest(
  httpBase: string,
  nickname: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Session> {
  const res = await fetchImpl(`${httpBase}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
    ...(signal ? { signal } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Session> & { error?: string };
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new GuestRefused(body.error ?? `http_${res.status}`, res.status);
  }
  if (!res.ok || typeof body.token !== "string") {
    throw new Error(body.error ?? `guest request failed (${res.status})`);
  }
  return body as Session;
}

export interface WakeOptions {
  /** Called once when the server looks asleep (slow or failing first attempt). */
  onWaking?: () => void;
  /** Give up after this long in total (ms). Free hosts can take ~60 s to wake. */
  totalMs?: number;
  /** Per-attempt timeout (ms). */
  attemptMs?: number;
  /** Call onWaking if the first attempt hasn't answered after this long (ms). */
  slowMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Cached session if its nickname matches, else a fresh guest. Retries with
 * backoff while the server wakes up (hosts on free tiers sleep when idle).
 */
export async function ensureSession(
  httpBase: string,
  nickname: string,
  fetchImpl: typeof fetch = fetch,
  wake: WakeOptions = {},
): Promise<Session> {
  const cached = loadSession();
  if (cached && cached.nickname === nickname.trim()) return cached;
  const now = wake.now ?? Date.now;
  const sleep = wake.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (wake.totalMs ?? 90_000);
  let warned = false;
  const warn = () => {
    if (!warned) {
      warned = true;
      wake.onWaking?.();
    }
  };
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const abort = setTimeout(() => ctrl.abort(), wake.attemptMs ?? 30_000);
    const slow = setTimeout(warn, wake.slowMs ?? 3_000);
    try {
      const sess = await createGuest(httpBase, nickname, fetchImpl, ctrl.signal);
      saveSession(sess);
      return sess;
    } catch (e) {
      if (e instanceof GuestRefused) throw e;
      warn();
      if (now() >= deadline) throw new Error("game server did not wake up in time", { cause: e });
      await sleep(Math.min(1_000 * 2 ** attempt, 8_000));
    } finally {
      clearTimeout(abort);
      clearTimeout(slow);
    }
  }
}
