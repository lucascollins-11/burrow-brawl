import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@burrow-brawl/shared/src/net";
import type { LobbyTransport } from "./transport";

/** Minimal WebSocket transport for the lobby (hello, welcome, ping). Replace with the O3 net module. */
export class WsTransport implements LobbyTransport {
  private ws: WebSocket | null = null;
  private msgHandlers = new Set<(m: ServerMessage) => void>();
  private closeHandlers = new Set<(c: number) => void>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly serverUrl: string) {}

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.serverUrl.replace(/\/$/, "")}/ws`);
      this.ws = ws;
      ws.onopen = () => this.send({ t: "hello", token, protocolVersion: PROTOCOL_VERSION });
      ws.onerror = () => reject(new Error("Could not reach the game server."));
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = decode(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          this.pingTimer = setInterval(
            () => this.send({ t: "ping", clientTime: Date.now() }),
            2000,
          );
          resolve();
        }
        this.msgHandlers.forEach((h) => h(msg));
      };
      ws.onclose = (ev) => {
        clearInterval(this.pingTimer);
        reject(new Error("Connection closed."));
        this.closeHandlers.forEach((h) => h(ev.code));
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  onMessage(handler: (msg: ServerMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onClose(handler: (code: number) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
