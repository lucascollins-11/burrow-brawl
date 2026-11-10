import { h } from "./dom";
import { CONTROLS, TIPS } from "./helpContent";
import type { Settings } from "./settings";

/** The slice of the audio manager the settings panel drives. */
export interface AudioControls {
  volume: number;
  muted: boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
}

export function renderHelp(onClose: () => void): HTMLElement {
  return h(
    "div",
    { class: "panel overlay help", attrs: { role: "dialog", "aria-label": "How to play" } },
    h("h2", { text: "How to play" }),
    h("p", {
      class: "tagline",
      text: "Take turns. Blast the other team's Molekins into the soda!",
    }),
    h(
      "div",
      { class: "help-groups" },
      ...CONTROLS.map((g) =>
        h(
          "section",
          {},
          h("h3", { text: g.title }),
          h(
            "ul",
            { class: "controls" },
            ...g.rows.map((r) =>
              h(
                "li",
                {},
                h("span", { class: "keys" }, ...r.keys.map((k) => h("kbd", { text: k }))),
                h("span", { text: r.action }),
              ),
            ),
          ),
        ),
      ),
    ),
    h("ul", { class: "tips" }, ...TIPS.map((t) => h("li", { text: t }))),
    h("button", { class: "btn primary big", text: "Got it", onclick: onClose }),
  );
}

export function renderSettings(
  settings: Settings,
  audio: AudioControls,
  actions: {
    onVolume(v: number): void;
    onMute(m: boolean): void;
    onReduceShake(r: boolean): void;
    onClose(): void;
  },
): HTMLElement {
  const vol = h("input", {
    attrs: { type: "range", min: "0", max: "100", step: "5", "aria-label": "Master volume" },
  });
  vol.value = String(Math.round(audio.volume * 100));
  const volLabel = h("span", { text: `Master volume: ${vol.value}%` });
  vol.oninput = () => {
    volLabel.textContent = `Master volume: ${vol.value}%`;
    actions.onVolume(Number(vol.value) / 100);
  };
  const toggle = (label: string, checked: boolean, on: (v: boolean) => void) => {
    const box = h("input", { attrs: { type: "checkbox" } });
    box.checked = checked;
    box.onchange = () => on(box.checked);
    return h("label", { class: "toggle" }, box, h("span", { text: label }));
  };
  return h(
    "div",
    { class: "panel overlay settings", attrs: { role: "dialog", "aria-label": "Settings" } },
    h("h2", { text: "Settings" }),
    h("label", { class: "setting" }, volLabel, vol),
    toggle("Mute all sounds", audio.muted, actions.onMute),
    toggle("Reduce screen shake", settings.reduceShake, actions.onReduceShake),
    h("button", { class: "btn primary big", text: "Done", onclick: actions.onClose }),
  );
}
