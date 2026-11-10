import type { ClientMessage } from "@burrow-brawl/shared/src/net";
import { GameClient, NetError, type NetMatch } from "../net";
import type { LobbyClient, UiStatus } from "./client";
import {
  applyRoom,
  applyRoomLeft,
  backToLobby as backToLobbyState,
  errorText,
  initialState,
  isHost,
  withError,
  withResult,
  type MatchResult,
  type UiState,
} from "./lobbyState";
import { h } from "./dom";
import { renderLobby } from "./lobbyView";
import { renderHelp, renderSettings, type AudioControls } from "./overlayViews";
import { renderResults } from "./resultsView";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { roomCodeFromPath } from "./routes";
import { renderTitle } from "./titleView";
import "./styles.css";

export interface UiOptions {
  /** Connect to the server (guest session + socket). Defaults to `GameClient.connect`. */
  connect?:
    ((nickname: string, onStatus: (s: UiStatus) => void) => Promise<LobbyClient>) | undefined;
  /** Called on every button press so the audio manager can play a click. */
  onClick?: () => void;
  /** The match started (or we rejoined one). Hand `client` and `match` to the game scene. */
  onMatchStart?: (client: LobbyClient, match: NetMatch) => void;
  /** Audio manager for the settings panel (volume and mute). Settings that need audio are hidden without it. */
  audio?: AudioControls;
  /** Called with the saved settings at startup and after every change (e.g. to resize the screen shake). */
  onSettingsChange?: (settings: Settings) => void;
  /** The match ended (also shows the results overlay). */
  onMatchEnd?: (winnerTeamId: string | null) => void;
}

/** How long connecting may take before we tell the player the server is waking up. */
const WAKING_AFTER_MS = 4000;

export interface UiHandle {
  /** The connected client, once a room has been created or joined. */
  readonly client: LobbyClient | null;
  /** Show the match-end overlay manually (normally driven by the client's matchEnd event). */
  showResults(result: MatchResult): void;
  dispose(): void;
}

// `onStatus` carries the pre-connect statuses ("waking" while the free-tier server cold-starts).
const defaultConnect = (nickname: string, onStatus: (s: UiStatus) => void): Promise<LobbyClient> =>
  GameClient.connect({
    nickname,
    onStatus: (s) => onStatus(s as UiStatus),
  }) as Promise<LobbyClient>;

/** Mounts the title, lobby and results screens over the canvas. */
export function mountUi(root: HTMLElement, opts: UiOptions = {}): UiHandle {
  const click = opts.onClick ?? (() => {});
  const connect = opts.connect ?? defaultConnect;
  let state: UiState = initialState;
  let client: LobbyClient | null = null;
  let nickname = "";
  let pendingCode: string | null = roomCodeFromPath(location.pathname);
  let busy = false;
  let titleError: string | null = null;
  let status: UiStatus | null = null;
  let lastAttempt: { nick: string; code: string | null } | null = null;
  let wakingTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptId = 0;
  const unsubs: (() => void)[] = [];

  const shell = h("div", { class: "ui-shell" });
  root.append(shell);

  // ---- help and settings overlays (available on every screen, including in-game)
  let settings = loadSettings();
  opts.onSettingsChange?.(settings);
  let overlay: "help" | "settings" | null = null;
  const overlayEl = h("div", { class: "ui-overlay", attrs: { role: "presentation" } });
  overlayEl.hidden = true;
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeOverlay();
  });
  const corner = h(
    "div",
    { class: "ui-corner" },
    h("button", {
      class: "btn small",
      text: "?",
      attrs: { "aria-label": "How to play", title: "How to play (H)" },
      onclick: () => (click(), showOverlay("help")),
    }),
    h("button", {
      class: "btn small",
      text: "⚙",
      attrs: { "aria-label": "Settings", title: "Settings" },
      onclick: () => (click(), showOverlay("settings")),
    }),
  );
  root.append(overlayEl, corner);

  function showOverlay(kind: "help" | "settings" | null): void {
    overlay = kind;
    overlayEl.replaceChildren();
    overlayEl.hidden = kind === null;
    if (kind === "help") overlayEl.append(renderHelp(() => (click(), closeOverlay())));
    if (kind === "settings") {
      const audio: AudioControls = opts.audio ?? {
        volume: 1,
        muted: false,
        setVolume: () => {},
        setMuted: () => {},
      };
      overlayEl.append(
        renderSettings(settings, audio, {
          onVolume: (v) => audio.setVolume(v),
          onMute: (m) => (click(), audio.setMuted(m)),
          onReduceShake: (r) => {
            click();
            settings = { ...settings, reduceShake: r };
            saveSettings(settings);
            opts.onSettingsChange?.(settings);
          },
          onClose: () => (click(), closeOverlay()),
        }),
      );
    }
  }
  function closeOverlay(): void {
    showOverlay(null);
  }
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Escape" && overlay) closeOverlay();
    else if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      showOverlay(overlay === "help" ? null : "help");
    }
  };
  window.addEventListener("keydown", onKey);

  const setState = (next: UiState): void => {
    state = next;
    render();
  };

  function render(): void {
    shell.replaceChildren();
    shell.hidden = state.screen === "starting";
    shell.classList.toggle("dim", state.screen === "results");
    if (state.screen === "starting") return;
    if (state.screen === "results" && state.room && state.result) {
      shell.append(
        renderResults(state.room, state.result, state.you?.id, {
          // Host only (the server answers not_host to everyone else).
          ...(typeof client?.rematch === "function" && isHost(state)
            ? { backToLobby: () => void backToLobby() }
            : {}),
          leave,
          click,
        }),
      );
    } else if (state.screen === "lobby" && state.room) {
      const lobby = renderLobby(state, { send: dispatch, leave, click });
      if (status === "reconnecting")
        lobby.prepend(
          h("div", { class: "error", text: "Reconnecting…", attrs: { role: "status" } }),
        );
      shell.append(lobby);
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
            help: () => showOverlay("help"),
            settings: () => showOverlay("settings"),
            click,
          },
        ),
      );
    }
  }

  /** Map the view's lobby messages onto GameClient calls; refusals show as a friendly error. */
  function dispatch(msg: ClientMessage): void {
    const c = client;
    if (!c) return;
    let p: Promise<void> | undefined;
    switch (msg.t) {
      case "lobby.setTeam":
        p = c.setTeam(msg.teamId);
        break;
      case "lobby.editTeam":
        p = c.editTeam(msg.teamId, msg.patch);
        break;
      case "lobby.addTeam":
        p = c.addTeam();
        break;
      case "lobby.removeTeam":
        p = c.removeTeam(msg.teamId);
        break;
      case "lobby.setSettings":
        p = c.setSettings(msg.patch);
        break;
      case "lobby.ready":
        p = c.setReady(msg.ready);
        break;
      case "lobby.kick":
        p = c.kick(msg.memberId);
        break;
      case "lobby.start":
        p = c.startMatch();
        break;
      default:
        return;
    }
    p.catch((e: unknown) => setState(withError(state, describe(e))));
  }

  function describe(e: unknown): string {
    if (e instanceof NetError) return errorText(e.code, e.message);
    return e instanceof Error ? e.message : "Something went wrong.";
  }

  function teardown(): void {
    unsubs.splice(0).forEach((u) => u());
    client?.close();
    client = null;
  }

  function attach(c: LobbyClient): void {
    unsubs.push(
      c.on("room", (room) => setState(applyRoom(state, room))),
      c.on("roomLeft", (reason) => {
        teardown();
        busy = false;
        setState(applyRoomLeft(state, reason));
      }),
      c.on("error", (code, message) => setState(withError(state, errorText(code, message)))),
      c.on("status", (s) => {
        status = s as UiStatus; // the net layer may also emit "waking"
        if (s === "closed" && client === c) {
          teardown();
          busy = false;
          state = { ...initialState, error: "Disconnected from the server." };
        }
        render();
      }),
      c.on("matchStart", (match) => opts.onMatchStart?.(c, match)),
      c.on("matchEnd", (winnerTeamId) => {
        setState(withResult(state, { winnerTeamId }));
        opts.onMatchEnd?.(winnerTeamId);
      }),
    );
  }

  async function start(nick: string, code: string | null): Promise<void> {
    const mine = ++attemptId;
    nickname = nick;
    lastAttempt = { nick, code };
    busy = true;
    status = "connecting";
    titleError = null;
    state = { ...state, error: null };
    clearTimeout(wakingTimer);
    wakingTimer = setTimeout(() => {
      if (busy && status === "connecting") {
        status = "waking";
        render();
      }
    }, WAKING_AFTER_MS);
    render();
    try {
      teardown();
      const c = await connect(nick, (s) => {
        if (mine !== attemptId || !busy) return;
        status = s;
        render();
      });
      if (mine !== attemptId) return c.close();
      client = c;
      attach(c);
      status = "open";
      const room = code ? await c.joinRoom(code) : await c.createRoom();
      clearTimeout(wakingTimer);
      busy = false;
      pendingCode = null;
      if (location.pathname.startsWith("/r/")) history.replaceState(null, "", "/");
      setState(applyRoom(state, room, c.me));
    } catch (e) {
      if (mine !== attemptId) return;
      clearTimeout(wakingTimer);
      status = "closed";
      teardown();
      busy = false;
      titleError = describe(e);
      render();
    }
  }

  async function backToLobby(): Promise<void> {
    const rematch = client?.rematch;
    if (!client || typeof rematch !== "function") return;
    try {
      await rematch.call(client);
    } catch (e) {
      return setState(withError(state, describe(e)));
    }
    // The server's lobby room.update normally gets here first; this covers a slow reply.
    setState(backToLobbyState(state));
  }

  function leave(): void {
    client?.leaveRoom();
    attemptId++;
    teardown();
    busy = false;
    titleError = null;
    state = initialState;
    render();
  }

  render();
  return {
    get client() {
      return client;
    },
    showResults(result) {
      setState(withResult(state, result));
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      overlayEl.remove();
      corner.remove();
      clearTimeout(wakingTimer);
      attemptId++;
      teardown();
      shell.remove();
    },
  };
}
