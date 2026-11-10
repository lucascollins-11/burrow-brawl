import { NICKNAME_MAX, normalizeRoomCode } from "@burrow-brawl/shared/src/net";
import { h } from "./dom";
import type { UiStatus } from "./client";

export const WAKING_TEXT = "Waking up the game server… (can take up to a minute)";

export interface TitleActions {
  create(nickname: string): void;
  join(nickname: string, code: string): void;
  /** Retry the last connection attempt. */
  retry(): void;
  help(): void;
  settings(): void;
  click(): void;
}

export function renderTitle(
  opts: {
    nickname: string;
    code: string | null;
    busy: boolean;
    error: string | null;
    status?: UiStatus | null;
    /** True when the last attempt failed and can be retried. */
    canRetry?: boolean;
  },
  a: TitleActions,
): HTMLElement {
  const nick = h("input", {
    class: "text",
    attrs: {
      maxlength: String(NICKNAME_MAX),
      placeholder: "Your nickname",
      "aria-label": "Nickname",
      autocomplete: "off",
    },
  });
  nick.value = opts.nickname;
  const code = h("input", {
    class: "text code-input",
    attrs: {
      maxlength: "5",
      placeholder: "ROOM CODE",
      "aria-label": "Room code",
      autocomplete: "off",
    },
  });
  code.value = opts.code ?? "";
  const err = h("div", { class: "error", attrs: { role: "alert" }, text: opts.error ?? "" });
  err.hidden = !opts.error;

  const nickOk = () => {
    const n = [...nick.value.trim()].length;
    if (n < 2) {
      err.hidden = false;
      err.textContent = "Pick a nickname with at least 2 characters.";
      nick.focus();
      return false;
    }
    return true;
  };
  const join = () => {
    if (!nickOk()) return;
    const c = normalizeRoomCode(code.value);
    if (!c) {
      err.hidden = false;
      err.textContent = "Room codes are 5 letters or numbers.";
      code.focus();
      return;
    }
    a.click();
    a.join(nick.value.trim(), c);
  };
  const create = () => {
    if (!nickOk()) return;
    a.click();
    a.create(nick.value.trim());
  };
  code.addEventListener("keydown", (e) => e.key === "Enter" && join());
  nick.addEventListener("keydown", (e) => e.key === "Enter" && (opts.code ? join() : create()));

  return h(
    "div",
    { class: "panel title" },
    h("h1", { text: "Burrow Brawl" }),
    h("p", { class: "tagline", text: "Tiny moles. Big hats. Bigger craters." }),
    opts.code ? h("p", { class: "invite", text: `You were invited to room ${opts.code}` }) : null,
    nick,
    err,
    opts.canRetry
      ? h("button", {
          class: "btn",
          text: "Try again",
          onclick: () => (a.click(), a.retry()),
        })
      : null,
    opts.busy && opts.status === "waking"
      ? h(
          "div",
          { class: "waking", attrs: { role: "status" } },
          h("span", { class: "spinner", attrs: { "aria-hidden": "true" } }),
          h("div", { text: WAKING_TEXT }),
        )
      : null,
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn primary big",
        text: opts.busy ? (opts.status === "waking" ? "Waking up…" : "Connecting…") : "Create room",
        disabled: opts.busy,
        onclick: create,
      }),
    ),
    h(
      "div",
      { class: "row" },
      code,
      h("button", { class: "btn big", text: "Join", disabled: opts.busy, onclick: join }),
    ),
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn small",
        text: "How to play",
        onclick: () => (a.click(), a.help()),
      }),
      h("button", {
        class: "btn small",
        text: "Settings",
        onclick: () => (a.click(), a.settings()),
      }),
    ),
  );
}
