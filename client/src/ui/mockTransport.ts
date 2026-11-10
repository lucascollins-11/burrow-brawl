import {
  DEFAULT_SETTINGS,
  HAT_COLORS,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from "@burrow-brawl/shared/src/net";
import type { ConnStatus, LobbyTransport } from "./transport";

/** In-memory fake server for tests and `?mock` dev: you are host of a room with one bot. */
export class MockTransport implements LobbyTransport {
  room: RoomState;
  sent: ClientMessage[] = [];
  private handlers = new Set<(m: ServerMessage) => void>();
  private closers = new Set<(c: number) => void>();
  private statusHandlers = new Set<(s: ConnStatus) => void>();

  constructor(private readonly me = { id: "guest_me", nickname: "You" }) {
    this.room = {
      code: "K7QX2",
      phase: "lobby",
      hostId: me.id,
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      members: [
        {
          id: me.id,
          nickname: me.nickname,
          teamId: "t1",
          ready: false,
          connected: true,
          pingMs: 30,
        },
        {
          id: "bot",
          nickname: "Bot Biscuit",
          teamId: "t2",
          ready: true,
          connected: true,
          pingMs: 60,
        },
      ],
      teams: [
        {
          id: "t1",
          name: "Team 1",
          hatColor: HAT_COLORS[0],
          hatStyle: "miner",
          critterNames: ["Pip", "Nib", "Dot", "Moss"],
          controllerId: me.id,
        },
        {
          id: "t2",
          name: "Team 2",
          hatColor: HAT_COLORS[3],
          hatStyle: "chef",
          critterNames: ["Fig", "Bun", "Tuck", "Lark"],
          controllerId: "bot",
        },
      ],
    };
  }

  async connect(): Promise<void> {
    this.emit({
      t: "welcome",
      you: this.me,
      serverTime: Date.now(),
      resumeToken: "r",
      protocolVersion: 1,
    });
  }

  send(msg: ClientMessage): void {
    this.sent.push(msg);
    const r = this.room;
    switch (msg.t) {
      case "room.create":
      case "room.join":
        if (msg.t === "room.join" && msg.code.toUpperCase() !== r.code)
          return this.emit({ t: "error", code: "room_not_found", message: "no such room" });
        return this.emit({ t: "room.joined", room: r });
      case "lobby.ready": {
        const me = r.members.find((m) => m.id === this.me.id)!;
        me.ready = msg.ready;
        break;
      }
      case "lobby.setSettings":
        Object.assign(r.settings, msg.patch);
        break;
      case "lobby.editTeam": {
        const t = r.teams.find((x) => x.id === msg.teamId);
        if (t) Object.assign(t, msg.patch);
        break;
      }
      case "lobby.start":
        r.phase = "loading";
        break;
      default:
        return;
    }
    r.version++;
    this.emit({ t: "room.update", room: structuredClone(r) });
  }

  onStatus(h: (s: ConnStatus) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }
  emitStatus(s: ConnStatus): void {
    this.statusHandlers.forEach((h) => h(s));
  }

  /** Test helper: push a server message. */
  emit(m: ServerMessage): void {
    this.handlers.forEach((h) => h(m));
  }
  onMessage(h: (m: ServerMessage) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  onClose(h: (c: number) => void): () => void {
    this.closers.add(h);
    return () => this.closers.delete(h);
  }
  close(): void {
    this.closers.forEach((h) => h(1000));
  }
}
