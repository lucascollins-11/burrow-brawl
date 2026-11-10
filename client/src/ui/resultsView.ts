import type { RoomState } from "@burrow-brawl/shared/src/net";
import { h } from "./dom";
import type { MatchResult } from "./lobbyState";

export interface ResultsActions {
  /** Present only when the net layer supports a rematch; otherwise the button is hidden. */
  backToLobby?: () => void;
  leave(): void;
  click(): void;
}

/** Headline and subtitle for a finished match. Pure, so it is unit tested. */
export function describeResult(
  room: RoomState,
  result: MatchResult,
  youId: string | undefined,
): { title: string; subtitle: string; color: string | null; youWon: boolean } {
  if (result.winnerTeamId === null)
    return {
      title: "It's a draw!",
      subtitle: "Everybody ended up in the soda.",
      color: null,
      youWon: false,
    };
  const team = room.teams.find((t) => t.id === result.winnerTeamId);
  const name = team?.name ?? "Somebody";
  const who = room.members.find((m) => m.id === team?.controllerId);
  const youWon = !!youId && who?.id === youId;
  return {
    title: youWon ? "You win!" : `${name} wins!`,
    subtitle: who ? `Played by ${who.nickname}` : "",
    color: team?.hatColor ?? null,
    youWon,
  };
}

/** Match-end overlay. Sits over the game canvas with a dimmed backdrop. */
export function renderResults(
  room: RoomState,
  result: MatchResult,
  youId: string | undefined,
  a: ResultsActions,
): HTMLElement {
  const d = describeResult(room, result, youId);
  return h(
    "div",
    { class: "panel results", attrs: { role: "dialog", "aria-label": "Match over" } },
    h("div", { class: "trophy", text: d.youWon ? "🏆" : "🎉" }),
    h("div", {
      class: "hat big-hat",
      style: { background: d.color ?? "#ddd" },
    }),
    h("h2", { text: d.title }),
    d.subtitle ? h("p", { class: "tagline", text: d.subtitle }) : null,
    h(
      "div",
      { class: "row" },
      a.backToLobby
        ? h("button", {
            class: "btn primary big",
            text: "Back to lobby",
            onclick: () => (a.click(), a.backToLobby?.()),
          })
        : null,
      h("button", { class: "btn big", text: "Leave room", onclick: () => (a.click(), a.leave()) }),
    ),
  );
}
