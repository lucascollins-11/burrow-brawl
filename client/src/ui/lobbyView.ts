import {
  HAT_COLORS,
  HAT_STYLES,
  MAX_TEAMS,
  type ClientMessage,
} from "@burrow-brawl/shared/src/net";
import { h } from "./dom";
import { inviteUrl } from "./routes";
import { isHost, myMember, myTeam, roomIsFull, startBlocker, type UiState } from "./lobbyState";

export interface LobbyActions {
  send(msg: ClientMessage): void;
  leave(): void;
  click(): void;
}

export function renderLobby(s: UiState, a: LobbyActions): HTMLElement {
  const room = s.room!;
  const host = isHost(s);
  const me = myMember(s);
  const mine = myTeam(s);
  const blocker = startBlocker(room);
  const locked = room.phase !== "lobby";

  const copy = (text: string, btn: HTMLButtonElement) => {
    a.click();
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy invite link"), 1500);
    });
  };
  const copyBtn = h("button", { class: "btn small", text: "Copy invite link" });
  copyBtn.onclick = () => copy(inviteUrl(location.origin, room.code), copyBtn);

  const members = h(
    "ul",
    { class: "members" },
    ...room.members.map((m) => {
      const team = room.teams.find((t) => t.id === m.teamId);
      return h(
        "li",
        { class: m.connected ? "" : "dim" },
        h("span", { class: "dot", style: { background: team?.hatColor ?? "#ccc" } }),
        h("span", { class: "nick", text: m.nickname + (m.id === s.you?.id ? " (you)" : "") }),
        m.id === room.hostId ? h("span", { class: "tag", text: "host" }) : null,
        h("span", { class: m.ready ? "tag ok" : "tag", text: m.ready ? "ready" : "not ready" }),
        host && m.id !== s.you?.id
          ? h("button", {
              class: "btn tiny",
              text: "Kick",
              onclick: () => (a.click(), a.send({ t: "lobby.kick", memberId: m.id })),
            })
          : null,
      );
    }),
  );

  const teams = h(
    "div",
    { class: "teams" },
    ...room.teams.map((t) => {
      const controller = room.members.find((m) => m.id === t.controllerId);
      const isMine = t.id === mine?.id;
      const takenColors = new Set(room.teams.filter((x) => x.id !== t.id).map((x) => x.hatColor));
      const canEdit = isMine || host;
      return h(
        "div",
        { class: "team" + (isMine ? " mine" : ""), style: { borderColor: t.hatColor } },
        h(
          "div",
          { class: "team-head" },
          h("span", { class: "hat", style: { background: t.hatColor } }),
          h("strong", { text: t.name }),
          h("span", { class: "who", text: controller ? controller.nickname : "open slot" }),
        ),
        h(
          "div",
          { class: "swatches" },
          ...HAT_COLORS.map((c) =>
            h("button", {
              class: "swatch" + (c === t.hatColor ? " sel" : ""),
              style: { background: c },
              disabled: !canEdit || locked || takenColors.has(c),
              attrs: { "aria-label": `Hat color ${c}`, title: c },
              onclick: () => (
                a.click(),
                a.send({ t: "lobby.editTeam", teamId: t.id, patch: { hatColor: c } })
              ),
            }),
          ),
        ),
        h(
          "div",
          { class: "styles" },
          ...HAT_STYLES.map((st) =>
            h("button", {
              class: "chip" + (st === t.hatStyle ? " sel" : ""),
              text: st,
              disabled: !canEdit || locked,
              onclick: () => (
                a.click(),
                a.send({ t: "lobby.editTeam", teamId: t.id, patch: { hatStyle: st } })
              ),
            }),
          ),
        ),
        controller
          ? isMine
            ? h("button", {
                class: "btn small",
                text: "Leave team",
                disabled: locked,
                onclick: () => (a.click(), a.send({ t: "lobby.setTeam", teamId: null })),
              })
            : null
          : h("button", {
              class: "btn small primary",
              text: "Join this team",
              disabled: locked,
              onclick: () => (a.click(), a.send({ t: "lobby.setTeam", teamId: t.id })),
            }),
      );
    }),
    host && room.teams.length < MAX_TEAMS && !roomIsFull({ ...room, members: [] })
      ? h("button", {
          class: "btn add-team",
          text: "+ Add team",
          onclick: () => (a.click(), a.send({ t: "lobby.addTeam" })),
        })
      : null,
  );

  const settingRow = (
    label: string,
    key: "turnSeconds" | "crittersPerTeam",
    min: number,
    max: number,
    step: number,
    unit = "",
  ) => {
    const v = room.settings[key];
    const input = h("input", {
      attrs: { type: "range", min: String(min), max: String(max), step: String(step) },
    });
    input.value = String(v);
    input.disabled = !host || locked;
    input.onchange = () => {
      a.click();
      a.send({ t: "lobby.setSettings", patch: { [key]: Number(input.value) } });
    };
    return h("label", { class: "setting" }, h("span", { text: `${label}: ${v}${unit}` }), input);
  };

  const settings = h(
    "div",
    { class: "settings" },
    h("h3", { text: "Match settings" }),
    settingRow("Turn time", "turnSeconds", 15, 90, 5, "s"),
    settingRow("Squirmlings per team", "crittersPerTeam", 1, 4, 1),
    host ? null : h("p", { class: "hint", text: "Only the host can change settings." }),
  );

  const readyBtn = h("button", {
    class: "btn" + (me?.ready ? "" : " primary"),
    text: me?.ready ? "Not ready" : "I'm ready!",
    disabled: locked || !me?.teamId,
    onclick: () => (a.click(), a.send({ t: "lobby.ready", ready: !me?.ready })),
  });

  return h(
    "div",
    { class: "panel lobby" },
    h(
      "div",
      { class: "lobby-top" },
      h(
        "div",
        {},
        h("div", { class: "small-label", text: "Room code" }),
        h("div", { class: "code", text: room.code }),
      ),
      copyBtn,
      h("button", { class: "btn small", text: "Leave", onclick: () => (a.click(), a.leave()) }),
    ),
    s.error ? h("div", { class: "error", text: s.error, attrs: { role: "alert" } }) : null,
    h(
      "div",
      { class: "cols" },
      h("div", {}, h("h3", { text: `Players (${room.members.length}/4)` }), members, settings),
      h("div", {}, h("h3", { text: "Teams" }), teams),
    ),
    h(
      "div",
      { class: "footer" },
      readyBtn,
      host
        ? h("button", {
            class: "btn primary big",
            text: locked ? "Starting…" : "Start match",
            disabled: locked || blocker !== null,
            attrs: { title: blocker ?? "" },
            onclick: () => (a.click(), a.send({ t: "lobby.start" })),
          })
        : h("span", { class: "hint", text: "Waiting for the host to start." }),
      host && blocker ? h("span", { class: "hint", text: blocker }) : null,
    ),
  );
}
