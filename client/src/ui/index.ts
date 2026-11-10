import type { ClientMessage } from "@burrow-brawl/shared/src/net";
import { GAME_SERVER_URL } from "../config";
import { h } from "./dom";
import { getGuest } from "./guest";
import { initialState, reduce, type UiState } from "./lobbyState";
import { renderLobby } from "./lobbyView";
import { roomCodeFromPath } from "./routes";
import { renderTitle } from "./titleView";
import type { LobbyTransport } from "./transport";
import { WsTransport } from "./wsTransport";
import "./styles.css";

export interface UiOptions {
  transport?: (() => LobbyTransport) | undefined;
  /** Called on every button press so the audio manager can play a click. */
  onClick?: () => void;
  /** Skip the guest HTTP call (mock/dev mode). */
  guestToken?: (() => Promise<{ token: string; nickname: string }>) | undefined;
  /** Called when the host starts the match and the room leaves the lobby. */
  onMatchStarting?: () => void;
}

/** Mounts the title and lobby screens over the canvas. Returns a teardown function. */
export function mountUi(root: HTMLElement, opts: UiOptions = {}): () => void {
  const click = opts.onClick ?? (() => {});
  let state: UiState = initialState;
  let transport: LobbyTransport | null = null;
  let nickname = "";
  let pendingCode: string | null = roomCodeFromPath(location.pathname);
  let busy = false;
  let titleError: string | null = null;
  const unsubs: (() => void)[] = [];

  const shell = h("div", { class: "ui-shell" });
  root.append(shell);

  function render(): void {
    shell.replaceChildren();
    shell.hidden = state.screen === "starting";
    if (state.screen === "starting") return;
    if (state.screen === "lobby" && state.room) {
      shell.append(
        renderLobby(state, {
          send: (m: ClientMessage) => transport?.send(m),
          leave,
          click,
        }),
      );
    } else {
      shell.append(
        renderTitle(
          { nickname, code: pendingCode, busy, error: titleError ?? state.error },
          { create: (n) => start(n, null), join: (n, c) => start(n, c), click },
        ),
      );
    }
  }

  function apply(msg: Parameters<typeof reduce>[1]): void {
    const was = state.screen;
    state = reduce(state, msg);
    if (state.screen === "lobby") busy = false;
    if (msg.t === "error" && state.screen === "title") busy = false;
    if (msg.t === "room.left") teardownTransport();
    if (was !== "starting" && state.screen === "starting") opts.onMatchStarting?.();
    render();
  }

  function teardownTransport(): void {
    unsubs.splice(0).forEach((u) => u());
    transport?.close();
    transport = null;
  }

  async function start(nick: string, code: string | null): Promise<void> {
    nickname = nick;
    busy = true;
    titleError = null;
    state = { ...state, error: null };
    render();
    try {
      const guest = opts.guestToken
        ? await opts.guestToken()
        : await getGuest(GAME_SERVER_URL, nick);
      teardownTransport();
      const t = (opts.transport ?? defaultTransport)();
      transport = t;
      unsubs.push(t.onMessage(apply));
      unsubs.push(
        t.onClose(() => {
          if (!transport) return;
          teardownTransport();
          state = { ...initialState, error: "Disconnected from the server." };
          busy = false;
          render();
        }),
      );
      await t.connect(guest.token);
      t.send(code ? { t: "room.join", code } : { t: "room.create" });
      pendingCode = null;
      if (location.pathname.startsWith("/r/")) history.replaceState(null, "", "/");
    } catch (e) {
      teardownTransport();
      busy = false;
      titleError = e instanceof Error ? e.message : "Something went wrong.";
      render();
    }
  }

  function leave(): void {
    transport?.send({ t: "room.leave" });
    teardownTransport();
    state = initialState;
    busy = false;
    render();
  }

  render();
  return () => {
    teardownTransport();
    shell.remove();
  };
}

function defaultTransport(): LobbyTransport {
  return new WsTransport(GAME_SERVER_URL);
}
