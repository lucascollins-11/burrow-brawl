import { h } from "./dom";

export interface LocalSetup {
  teams: number;
  size: number;
}

export const LOCAL_LIMITS = { teams: [2, 8], size: [1, 4] } as const;
export const DEFAULT_LOCAL: LocalSetup = { teams: 2, size: 2 };

export function clampLocal(s: LocalSetup): LocalSetup {
  const c = (v: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, v));
  return { teams: c(s.teams, LOCAL_LIMITS.teams), size: c(s.size, LOCAL_LIMITS.size) };
}

/** Quick setup for a hot-seat match on one computer. No server needed. */
export function renderLocalSetup(
  setup: LocalSetup,
  a: {
    change(next: LocalSetup): void;
    start(setup: LocalSetup): void;
    back(): void;
    click(): void;
  },
): HTMLElement {
  const stepper = (
    label: string,
    key: keyof LocalSetup,
    limits: readonly [number, number],
  ): HTMLElement => {
    const set = (d: number) => {
      a.click();
      a.change(clampLocal({ ...setup, [key]: setup[key] + d }));
    };
    return h(
      "div",
      { class: "row stepper" },
      h("span", { class: "stepper-label", text: label }),
      h("button", {
        class: "btn small",
        text: "−",
        disabled: setup[key] <= limits[0],
        attrs: { "aria-label": `Fewer ${label.toLowerCase()}` },
        onclick: () => set(-1),
      }),
      h("strong", { class: "stepper-value", text: String(setup[key]), attrs: { role: "status" } }),
      h("button", {
        class: "btn small",
        text: "+",
        disabled: setup[key] >= limits[1],
        attrs: { "aria-label": `More ${label.toLowerCase()}` },
        onclick: () => set(1),
      }),
    );
  };
  return h(
    "div",
    { class: "panel title local-setup" },
    h("h2", { text: "Local play" }),
    h("p", { class: "hint", text: "Pass the keyboard around. No internet or server needed." }),
    stepper("Teams", "teams", LOCAL_LIMITS.teams),
    stepper("Critters per team", "size", LOCAL_LIMITS.size),
    h("button", {
      class: "btn primary big",
      text: "Start match",
      onclick: () => (a.click(), a.start(setup)),
    }),
    h("button", { class: "btn", text: "Back", onclick: () => (a.click(), a.back()) }),
  );
}
