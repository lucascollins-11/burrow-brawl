import { NICKNAME_MAX, normalizeRoomCode } from "@burrow-brawl/shared/src/net";
import { h } from "./dom";

export interface TitleActions {
  create(nickname: string): void;
  join(nickname: string, code: string): void;
  click(): void;
}

export function renderTitle(
  opts: { nickname: string; code: string | null; busy: boolean; error: string | null },
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
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn primary big",
        text: opts.busy ? "Connecting…" : "Create room",
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
  );
}
