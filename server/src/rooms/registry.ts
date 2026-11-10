import { randomBytes, randomInt } from "node:crypto";
import {
  MAX_MEMBERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ErrorCode,
} from "@burrow-brawl/shared/src/net";
import { Room, type Peer } from "./room";

interface ResumeEntry {
  sub: string;
  /** null while the owning connection is live. */
  expiresAt: number | null;
}

export interface RegistryOptions {
  now: () => number;
  resumeWindowMs: number;
  emptyRoomTtlMs: number;
  /** For tests: deterministic room codes. */
  codeGen?: () => string;
  /** Match tick source (tests use "manual"). */
  ticker?: "realtime" | "manual";
}

export function randomRoomCode(): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return s;
}

/** All rooms, which room each player is in, and resume tokens. In memory (v1). */
export class Registry {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<string, string>();
  private readonly resume = new Map<string, ResumeEntry>();
  private readonly resumeBySub = new Map<string, string>();

  constructor(private readonly opts: RegistryOptions) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomFor(sub: string): Room | undefined {
    const code = this.roomOf.get(sub);
    return code ? this.rooms.get(code) : undefined;
  }

  create(sub: string, nickname: string, peer: Peer, re?: number): Room {
    this.leave(sub);
    const gen = this.opts.codeGen ?? randomRoomCode;
    let code = gen();
    for (let tries = 0; this.rooms.has(code); tries++) {
      if (tries > 50) throw new Error("could not allocate a room code");
      code = gen();
    }
    const room = new Room(
      code,
      sub,
      this.opts.now,
      (id) => {
        if (this.roomOf.get(id) === code) this.roomOf.delete(id);
      },
      { ticker: this.opts.ticker ?? "realtime" },
    );
    this.rooms.set(code, room);
    this.roomOf.set(sub, code);
    room.attach(sub, nickname, peer, re);
    return room;
  }

  join(sub: string, nickname: string, code: string, peer: Peer, re?: number): ErrorCode | null {
    const room = this.rooms.get(code);
    if (!room) return "room_not_found";
    const current = this.roomOf.get(sub);
    if (current !== code) {
      // Check before leaving the old room, so a failed join keeps the old seat.
      if (room.phase !== "lobby") return "match_in_progress";
      if (room.size >= MAX_MEMBERS && !room.has(sub)) return "room_full";
      this.leave(sub);
    }
    const err = room.attach(sub, nickname, peer, re);
    if (err) return err;
    this.roomOf.set(sub, code);
    return null;
  }

  leave(sub: string, reason: "left" | "kicked" = "left"): void {
    const room = this.roomFor(sub);
    this.roomOf.delete(sub);
    if (!room) return;
    room.remove(sub, reason);
    if (room.size === 0) this.rooms.delete(room.code);
  }

  // ------------------------------------------------------------ resume tokens

  /** New token for a live connection; revokes the sub's previous one. */
  issueResumeToken(sub: string): string {
    const old = this.resumeBySub.get(sub);
    if (old) this.resume.delete(old);
    const token = randomBytes(24).toString("base64url");
    this.resume.set(token, { sub, expiresAt: null });
    this.resumeBySub.set(sub, token);
    return token;
  }

  /** The connection that owns `token` closed; start its expiry clock. */
  startResumeClock(sub: string): void {
    const token = this.resumeBySub.get(sub);
    const e = token ? this.resume.get(token) : undefined;
    if (e) e.expiresAt = this.opts.now() + this.opts.resumeWindowMs;
  }

  /** True if `token` belongs to `sub` and hasn't expired. Single use. */
  consumeResumeToken(sub: string, token: string): boolean {
    const e = this.resume.get(token);
    if (!e || e.sub !== sub) return false;
    this.resume.delete(token);
    if (this.resumeBySub.get(sub) === token) this.resumeBySub.delete(sub);
    return e.expiresAt === null || e.expiresAt > this.opts.now();
  }

  // ------------------------------------------------------------ cleanup

  sweep(): void {
    const t = this.opts.now();
    for (const [token, e] of this.resume) {
      if (e.expiresAt !== null && e.expiresAt <= t) {
        this.resume.delete(token);
        if (this.resumeBySub.get(e.sub) === token) this.resumeBySub.delete(e.sub);
      }
    }
    for (const room of [...this.rooms.values()]) {
      room.sweep(this.opts.resumeWindowMs);
      const empty = room.size === 0;
      const idle = room.connectedCount() === 0 && t - room.lastActiveAt >= this.opts.emptyRoomTtlMs;
      if (empty || idle) this.closeRoom(room);
    }
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room);
  }

  private closeRoom(room: Room): void {
    room.closeAll();
    this.rooms.delete(room.code);
  }
}
