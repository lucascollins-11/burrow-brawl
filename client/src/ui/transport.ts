import type { ClientMessage, ServerMessage } from "@burrow-brawl/shared/src/net";

/**
 * What the lobby UI needs from the network layer. The real client net module
 * (O3, client/src/net) should implement this; until it lands, `wsTransport.ts`
 * is a minimal stand-in and `mockTransport.ts` drives tests and offline dev.
 */
export interface LobbyTransport {
  /** Open the socket and send `hello`. Resolves after `welcome`. */
  connect(token: string): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  onClose(handler: (code: number) => void): () => void;
  close(): void;
}
