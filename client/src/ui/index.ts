import type { ClientMessage } from "@burrow-brawl/shared/src/net";
import { GAME_SERVER_URL } from "../config";
import { h } from "./dom";
import { getGuest } from "./guest";
import { initialState, reduce, withResult, type MatchResult, type UiState } from "./lobbyState";
import { renderLobby } from "./lobbyView";
import { roomCodeFromPath } from "./routes";
import { renderResults } from "./resultsView";
import { renderTitle } from "./titleView";
import type { ConnStatus, LobbyTransport } from "./transport";
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

/** How long the guest/connect step may take before we tell the player the server is waking up. */
const WAKING_AFTER_MS = 4000;

export interface UiHandle {
  /** Show the match-end overlay (call when the net layer reports the match is over). */
  showResults(result: MatchResult): void;
  dispose(): void;
}

/** Mounts the title, lobby and results screens over the canvas. */
export function mountUi(root: HTMLElement, opts: UiOptions = {}): UiHandle {
  const click = opts.onClick ?? (() => {});
  let state: UiState = initialState;
  let transport: LobbyTransport | null = null;
  let nickname = "";
  let pendingCode: string | null = roomCodeFromPath(location.pathname);
  let busy = false;
  let titleError: string | null = null;
  let status: ConnStatus | null = null;
  let lastAttempt: { nick: string; code: string | null } | null = null;
  let wakingTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubs: (() => void)[] = [];

  const shell = h("div", { class: "ui-shell" });
  root.append(shell);

  function render(): void {
    shell.replaceChildren();
    shell.hidden = state.screen === "starting";
    shell.classList.toggle("dim", state.screen === "results");
    if (state.screen === "starting") return;
    if (state.screen === "results" && state.room && state.result) {
      shell.append(
        renderResults(state.room, state.result, state.you?.id, {
          leave,
          click,
        }),
      );
    } else if (state.screen === "lobby" && state.room) {
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
          {
            nickname,
            code: pendingCode,
            busy,
            error: titleError ?? state.error,
            status,
            canRetry: !busy && titleError !== null && lastAttempt !== null,
          },
          {
            create: (n) => void start(n, null),
            join: (n, c) => void start(n, c),
            retry: () => lastAttempt && void start(lastAttempt.nick, lastAttempt.code),
            click,
          },
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
    lastAttempt = { nick, code };
    busy = true;
    status = "connecting";
    titleError = null;
    clearTimeout(wakingTimer);
    wakingTimer = setTimeout(() => {
      if (busy && status === "connecting") {
        status = "waking";
        render();
      }
    }, WAKING_AFTER_MS);
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
      const offStatus = t.onStatus?.((st) => {
        status = st;
        render();
      });
      if (offStatus) unsubs.push(offStatus);
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
      clearTimeout(wakingTimer);
      status = "connected";
      t.send(code ? { t: "room.join", code } : { t: "room.create" });
      pendingCode = null;
      if (location.pathname.startsWith("/r/")) history.replaceState(null, "", "/");
    } catch (e) {
      clearTimeout(wakingTimer);
      status = "failed";
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
  return {
    showResults(result) {
      state = withResult(state, result);
      render();
    },
    dispose() {
      clearTimeout(wakingTimer);
      teardownTransport();
      shell.remove();
    },
  };
}

function defaultTransport(): LobbyTransport {
  return new WsTransport(GAME_SERVER_URL);
}
