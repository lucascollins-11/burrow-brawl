const KEY = "burrowbrawl.settings";

export interface Settings {
  /** Fewer / no camera shake on explosions. */
  reduceShake: boolean;
}

export const DEFAULT_SETTINGS: Settings = { reduceShake: false };

/** Coerce unknown stored data into valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    reduceShake: typeof o.reduceShake === "boolean" ? o.reduceShake : DEFAULT_SETTINGS.reduceShake,
  };
}

export function loadSettings(storage: Pick<Storage, "getItem"> | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  s: Settings,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or quota: settings just won't persist */
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Shake size in world units: normal, or 0 when reduced. Matches ScreenShake's default. */
export const NORMAL_SHAKE = 28;
export const shakeFor = (s: Settings): number => (s.reduceShake ? 0 : NORMAL_SHAKE);
