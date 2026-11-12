import {
  DEFAULT_SETTINGS,
  mapOptions,
  HAT_COLORS,
  type RoomState,
  type TeamPatch,
  type MatchSettings,
} from "@burrow-brawl/shared/src/net";
import type { GameClientEvents } from "../net";
import type { LobbyClient } from "./client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCb = (...args: any[]) => void;

/** In-memory fake `GameClient` for tests and `?mock` dev: you are host of a room with one bot. */
export class MockClient implements LobbyClient {
  room: RoomState | null = null;
  readonly me = { id: "guest_me", nickname: "You" };
  calls: string[] = [];
  private listeners = new Map<string, Set<AnyCb>>();
  private readonly state: RoomState;

  constructor(nickname = "You") {
    this.me = { id: "guest_me", nickname };
    this.state = {
      code: "K7QX2",
      phase: "lobby",
      hostId: this.me.id,
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      mapOptions: mapOptions(),
      members: [
        { id: this.me.id, nickname, teamId: "t1", ready: false, connected: true, pingMs: 30 },
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
          controllerId: this.me.id,
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

  get isHost(): boolean {
    return this.room?.hostId === this.me.id;
  }

  on<K extends keyof GameClientEvents>(event: K, cb: GameClientEvents[K]): () => void {
    const set = this.listeners.get(event) ?? new Set<AnyCb>();
    this.listeners.set(event, set);
    set.add(cb);
    return () => set.delete(cb);
  }

  /** Test helper: fire a client event. */
  emit<K extends keyof GameClientEvents>(event: K, ...args: Parameters<GameClientEvents[K]>): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  private publish(): RoomState {
    this.state.version++;
    this.room = structuredClone(this.state);
    this.emit("room", this.room);
    return this.room;
  }

  async createRoom(): Promise<RoomState> {
    this.calls.push("createRoom");
    this.room = structuredClone(this.state);
    return this.room;
  }
  async joinRoom(code: string): Promise<RoomState> {
    this.calls.push(`joinRoom:${code}`);
    if (code.toUpperCase() !== this.state.code) {
      const { NetError } = await import("../net");
      throw new NetError("room_not_found", "no such room");
    }
    this.room = structuredClone(this.state);
    return this.room;
  }
  leaveRoom(): void {
    this.calls.push("leaveRoom");
  }
  async setTeam(): Promise<void> {
    this.calls.push("setTeam");
  }
  async editTeam(teamId: string, patch: TeamPatch): Promise<void> {
    Object.assign(this.state.teams.find((t) => t.id === teamId) ?? {}, patch);
    this.publish();
  }
  async addTeam(): Promise<void> {
    this.calls.push("addTeam");
  }
  async removeTeam(): Promise<void> {
    this.calls.push("removeTeam");
  }
  async setSettings(patch: Partial<MatchSettings>): Promise<void> {
    Object.assign(this.state.settings, patch);
    this.publish();
  }
  async setReady(ready: boolean): Promise<void> {
    this.state.members[0]!.ready = ready;
    this.publish();
  }
  async kick(): Promise<void> {
    this.calls.push("kick");
  }
  async startMatch(): Promise<void> {
    this.state.phase = "loading";
    this.publish();
  }
  async rematch(): Promise<void> {
    this.state.phase = "lobby";
    this.publish();
  }
  close(): void {
    this.calls.push("close");
  }
}
