// Wire protocol types, constants and validation. See docs/protocol.md.
// Dependency-free on purpose so client, server and tests can all import it.

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- constants

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const MAX_MEMBERS = 4; // v1: one player per team, no spectators
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const MAX_CRITTERS = 4;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
export const TEAM_NAME_MAX = 20;
export const CRITTER_NAME_MAX = 14;
export const CHAT_MAX = 200;

export const HAT_COLORS = [
  "#f28b82", // strawberry
  "#fbbc04", // butterscotch
  "#81c995", // mint
  "#8ab4f8", // blueberry
  "#c58af9", // grape
  "#fdcfe8", // bubblegum
  "#e6c9a8", // biscuit
  "#a7ffeb", // seafoam
] as const;

export const HAT_STYLES = ["miner", "chef", "tricorn", "cone", "beanie", "propeller"] as const;

export type HatColor = (typeof HAT_COLORS)[number];
export type HatStyle = (typeof HAT_STYLES)[number];

export const ErrorCodes = [
  "bad_message",
  "version_mismatch",
  "unauthorized",
  "room_not_found",
  "room_full",
  "match_in_progress",
  "team_taken",
  "not_host",
  "not_in_room",
  "not_allowed",
  "not_your_turn",
  "input_rejected",
  "rate_limited",
  "name_invalid",
  "internal",
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];

export const CloseCodes = {
  noHello: 4001,
  replaced: 4002,
  kicked: 4003,
  roomClosed: 4004,
  tooManyInvalid: 4005,
  versionMismatch: 4006,
  unauthorized: 4007,
} as const;

// ---------------------------------------------------------------- state

export type RoomPhase = "lobby" | "loading" | "match" | "results";

export interface Member {
  id: string;
  nickname: string;
  teamId: string | null;
  ready: boolean;
  connected: boolean;
  pingMs: number;
}

export interface TeamSetup {
  id: string;
  name: string;
  hatColor: HatColor;
  hatStyle: HatStyle;
  critterNames: string[];
  controllerId: string | null;
}

export interface MatchSettings {
  mapId: string; // "random" or a map id
  mapSeed: number; // u32
  turnSeconds: number; // 15..90
  retreatSeconds: number; // 0..10
  crittersPerTeam: number; // 1..4
  startHealth: number; // 25..200
  suddenDeathRound: number; // 0 = off, else 1..50
  windMax: number; // 0..100
  crateChance: number; // 0..1
  arsenalPreset: string;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  members: Member[];
  teams: TeamSetup[];
  settings: MatchSettings;
  version: number;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  mapId: "random",
  mapSeed: 0,
  turnSeconds: 45,
  retreatSeconds: 3,
  crittersPerTeam: 4,
  startHealth: 100,
  suddenDeathRound: 0,
  windMax: 50,
  crateChance: 0.5,
  arsenalPreset: "standard",
};

// ---------------------------------------------------------------- messages

export type TeamPatch = Partial<Pick<TeamSetup, "name" | "hatColor" | "hatStyle" | "critterNames">>;

export type ClientMessage =
  | { t: "hello"; seq?: number; token: string; protocolVersion: number; resumeToken?: string }
  | { t: "room.create"; seq?: number }
  | { t: "room.join"; seq?: number; code: string }
  | { t: "room.leave"; seq?: number }
  | { t: "room.sync"; seq?: number }
  | { t: "lobby.setTeam"; seq?: number; teamId: string | null }
  | { t: "lobby.editTeam"; seq?: number; teamId: string; patch: TeamPatch }
  | { t: "lobby.addTeam"; seq?: number }
  | { t: "lobby.removeTeam"; seq?: number; teamId: string }
  | { t: "lobby.setSettings"; seq?: number; patch: Partial<MatchSettings> }
  | { t: "lobby.ready"; seq?: number; ready: boolean }
  | { t: "lobby.kick"; seq?: number; memberId: string }
  | { t: "lobby.start"; seq?: number }
  | { t: "chat"; seq?: number; text: string }
  | { t: "ping"; seq?: number; clientTime: number };

export type ServerMessage =
  | {
      t: "welcome";
      you: { id: string; nickname: string };
      serverTime: number;
      resumeToken: string;
      protocolVersion: number;
    }
  | { t: "room.joined"; re?: number; room: RoomState }
  | { t: "room.update"; room: RoomState }
  | { t: "room.left"; reason: "left" | "kicked" | "closed" }
  | { t: "chat"; from: string; text: string; at: number }
  | { t: "pong"; re?: number; clientTime: number; serverTime: number }
  | { t: "ok"; re?: number }
  | { t: "error"; re?: number; code: ErrorCode; message: string };

export type ClientMessageType = ClientMessage["t"];

// ---------------------------------------------------------------- validation

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const ID_MAX = 64;

/** Only these keys may appear on a message of the given type (plus t, seq). */
const ALLOWED_KEYS: Record<ClientMessageType, readonly string[]> = {
  hello: ["token", "protocolVersion", "resumeToken"],
  "room.create": [],
  "room.join": ["code"],
  "room.leave": [],
  "room.sync": [],
  "lobby.setTeam": ["teamId"],
  "lobby.editTeam": ["teamId", "patch"],
  "lobby.addTeam": [],
  "lobby.removeTeam": ["teamId"],
  "lobby.setSettings": ["patch"],
  "lobby.ready": ["ready"],
  "lobby.kick": ["memberId"],
  "lobby.start": [],
  chat: ["text"],
  ping: ["clientTime"],
};

function onlyKeys(o: Obj, allowed: readonly string[]): string | null {
  for (const k of Object.keys(o)) {
    if (k !== "t" && k !== "seq" && !allowed.includes(k)) return `unexpected field "${k}"`;
  }
  return null;
}

// C0/C1 controls, zero-width and bidi-override characters. Built from a
// string so the source file stays plain ASCII.
const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]",
  "g",
);

/** Strip control chars, collapse whitespace, trim. */
export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").replace(CONTROL_CHARS, "").trim();
}

export function validNickname(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const s = cleanText(raw);
  const len = [...s].length;
  return len >= NICKNAME_MIN && len <= NICKNAME_MAX ? s : null;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function validateTeamPatch(p: unknown): Parsed<TeamPatch> {
  if (!isObj(p)) return { ok: false, error: "patch must be an object" };
  const out: TeamPatch = {};
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case "name": {
        if (!isStr(v, 64)) return { ok: false, error: "bad name" };
        const s = cleanText(v);
        if (s.length < 1 || [...s].length > TEAM_NAME_MAX) return { ok: false, error: "bad name" };
        out.name = s;
        break;
      }
      case "hatColor":
        if (!(HAT_COLORS as readonly unknown[]).includes(v))
          return { ok: false, error: "bad hatColor" };
        out.hatColor = v as HatColor;
        break;
      case "hatStyle":
        if (!(HAT_STYLES as readonly unknown[]).includes(v))
          return { ok: false, error: "bad hatStyle" };
        out.hatStyle = v as HatStyle;
        break;
      case "critterNames": {
        if (!Array.isArray(v) || v.length < 1 || v.length > MAX_CRITTERS)
          return { ok: false, error: "bad critterNames" };
        const names: string[] = [];
        for (const n of v) {
          if (!isStr(n, 64)) return { ok: false, error: "bad critterNames" };
          const s = cleanText(n);
          if (s.length < 1 || [...s].length > CRITTER_NAME_MAX)
            return { ok: false, error: "bad critterNames" };
          names.push(s);
        }
        out.critterNames = names;
        break;
      }
      default:
        return { ok: false, error: `unexpected field "${k}"` };
    }
  }
  return { ok: true, value: out };
}

const SETTINGS_RULES: { [K in keyof MatchSettings]: (v: unknown) => boolean } = {
  mapId: (v) => isStr(v, 32) && /^[a-z0-9-]+$/.test(v),
  mapSeed: (v) => isInt(v, 0, 0xffffffff),
  turnSeconds: (v) => isInt(v, 15, 90),
  retreatSeconds: (v) => isInt(v, 0, 10),
  crittersPerTeam: (v) => isInt(v, 1, MAX_CRITTERS),
  startHealth: (v) => isInt(v, 25, 200),
  suddenDeathRound: (v) => isInt(v, 0, 50),
  windMax: (v) => isInt(v, 0, 100),
  crateChance: (v) => isNum(v, 0, 1),
  arsenalPreset: (v) => isStr(v, 32) && /^[a-z0-9-]+$/.test(v),
};

export function validateSettingsPatch(p: unknown): Parsed<Partial<MatchSettings>> {
  if (!isObj(p)) return { ok: false, error: "patch must be an object" };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    const rule = (SETTINGS_RULES as Record<string, ((v: unknown) => boolean) | undefined>)[k];
    if (!rule || !Object.hasOwn(SETTINGS_RULES, k))
      return { ok: false, error: `unexpected field "${k}"` };
    if (!rule(v)) return { ok: false, error: `bad ${k}` };
    out[k] = v;
  }
  return { ok: true, value: out as Partial<MatchSettings> };
}

const withSeq = (raw: Obj): { seq?: number } =>
  typeof raw.seq === "number" ? { seq: raw.seq } : {};

/** Validate an untrusted decoded frame into a ClientMessage. */
export function parseClientMessage(raw: unknown): Parsed<ClientMessage> {
  const bad = (error: string): Parsed<ClientMessage> => ({ ok: false, error });
  if (!isObj(raw)) return bad("message must be an object");
  const t = raw.t;
  if (typeof t !== "string" || !Object.hasOwn(ALLOWED_KEYS, t)) return bad("unknown message type");
  const type = t as ClientMessageType;
  if (raw.seq !== undefined && !isInt(raw.seq, 0, 0xffffffff)) return bad("bad seq");
  const extra = onlyKeys(raw, ALLOWED_KEYS[type]);
  if (extra) return bad(extra);
  const ok = (): Parsed<ClientMessage> => ({ ok: true, value: raw as unknown as ClientMessage });

  switch (type) {
    case "hello":
      if (!isStr(raw.token, 4096) || raw.token.length === 0) return bad("bad token");
      if (!isInt(raw.protocolVersion, 0, 0xffff)) return bad("bad protocolVersion");
      if (raw.resumeToken !== undefined && !isStr(raw.resumeToken, 128))
        return bad("bad resumeToken");
      return ok();
    case "room.join":
      if (!isStr(raw.code, 16)) return bad("bad code");
      return ok();
    case "lobby.setTeam":
      if (raw.teamId !== null && !isStr(raw.teamId, ID_MAX)) return bad("bad teamId");
      return ok();
    case "lobby.editTeam": {
      if (!isStr(raw.teamId, ID_MAX)) return bad("bad teamId");
      const p = validateTeamPatch(raw.patch);
      if (!p.ok) return bad(p.error);
      return { ok: true, value: { ...withSeq(raw), t: type, teamId: raw.teamId, patch: p.value } };
    }
    case "lobby.removeTeam":
      if (!isStr(raw.teamId, ID_MAX)) return bad("bad teamId");
      return ok();
    case "lobby.setSettings": {
      const p = validateSettingsPatch(raw.patch);
      if (!p.ok) return bad(p.error);
      return { ok: true, value: { ...withSeq(raw), t: type, patch: p.value } };
    }
    case "lobby.ready":
      if (typeof raw.ready !== "boolean") return bad("bad ready");
      return ok();
    case "lobby.kick":
      if (!isStr(raw.memberId, ID_MAX)) return bad("bad memberId");
      return ok();
    case "chat":
      if (!isStr(raw.text, CHAT_MAX * 2)) return bad("bad text");
      return ok();
    case "ping":
      if (!isNum(raw.clientTime, 0, Number.MAX_SAFE_INTEGER)) return bad("bad clientTime");
      return ok();
    case "room.create":
    case "room.leave":
    case "room.sync":
    case "lobby.addTeam":
    case "lobby.start":
      return ok();
  }
}
