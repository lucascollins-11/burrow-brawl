import { compass, summarizeTeams, turnBanner, turnOrder, windStreamer } from "./hudModel";
import { cssHex, teamColor } from "./teamColors";
import type { AimState } from "./cameraRig";
import type { ViewState } from "./viewState";

const CSS = `
.h3 { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 system-ui, sans-serif; color: #3b2a1a; }
.h3 * { box-sizing: border-box; }
.h3-banner { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); padding: 6px 18px; background: #fff8ea; border: 3px solid #3b2a1a; border-radius: 16px; box-shadow: 0 4px 0 #3b2a1a; font-weight: 700; text-align: center; white-space: nowrap; }
.h3-timer { font-size: 22px; margin-right: 10px; }
.h3-order { position: absolute; top: 62px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
.h3-dot { width: 22px; height: 22px; border-radius: 50%; border: 3px solid #3b2a1a; opacity: .75; }
.h3-dot.act { transform: scale(1.35); opacity: 1; box-shadow: 0 0 0 3px #fff8ea; }
.h3-teams { position: absolute; top: 10px; right: 10px; display: grid; gap: 5px; width: 190px; }
.h3-team { background: #fff8eacc; border: 2px solid #3b2a1a; border-radius: 10px; padding: 3px 7px; display: grid; grid-template-columns: 1fr auto; gap: 0 6px; font-size: 12px; }
.h3-team.act { background: #fff8ea; outline: 3px solid #ffd23f; }
.h3-team.out { opacity: .4; }
.h3-bar { grid-column: 1 / 3; height: 7px; background: #e6d7bd; border-radius: 4px; overflow: hidden; }
.h3-bar > div { height: 100%; }
.h3-wind { position: absolute; top: 10px; left: 10px; width: 92px; padding: 6px; background: #fff8eacc; border: 2px solid #3b2a1a; border-radius: 12px; text-align: center; font-weight: 700; }
.h3-arrow { width: 40px; height: 40px; margin: 2px auto; display: grid; place-items: center; font-size: 30px; transition: transform .2s; }
.h3-cross { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 2px #3b2a1a, inset 0 0 0 2px #3b2a1a; display: none; }
.h3-cross::after { content: ""; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; background: #e85d4a; border-radius: 50%; }
.h3-power { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); width: 260px; padding: 6px 10px; background: #fff8ea; border: 3px solid #3b2a1a; border-radius: 14px; text-align: center; display: none; }
.h3-power .h3-bar { height: 12px; margin-top: 4px; }
.h3-hint { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); padding: 3px 10px; background: #fff8eacc; border-radius: 10px; font-size: 12px; white-space: nowrap; }
`;

const el = (tag: string, cls: string, parent: HTMLElement, text = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent.append(e);
  return e;
};

/** HUD for up to 8 teams: banner and timer, turn-order strip, compact team bars, wind, aim crosshair and power. */
export class Hud3D {
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly banner: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly order: HTMLElement;
  private readonly teams: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly windText: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly power: HTMLElement;
  private readonly powerText: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly hint: HTMLElement;
  private shown = "";

  constructor(parent: HTMLElement = document.body) {
    this.style = document.createElement("style");
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.root = el("div", "h3", parent);
    this.banner = el("div", "h3-banner", this.root);
    this.timer = el("span", "h3-timer", this.banner);
    this.bannerText = el("span", "bb-turn", this.banner);
    this.order = el("div", "h3-order", this.root);
    this.teams = el("div", "h3-teams", this.root);
    const wind = el("div", "h3-wind", this.root);
    el("div", "", wind, "Wind");
    this.arrow = el("div", "h3-arrow", wind, "➤");
    this.windText = el("div", "", wind);
    this.cross = el("div", "h3-cross", this.root);
    this.power = el("div", "h3-power", this.root);
    this.powerText = el("div", "bb-power", this.power);
    this.powerFill = el("div", "", el("div", "h3-bar", this.power));
    this.powerFill.style.background = "#e85d4a";
    this.hint = el("div", "h3-hint", this.root);
  }

  update(v: ViewState, aim: AimState | null, hint: string, weapon = ""): void {
    this.timer.textContent = v.phase === "control" ? String(Math.ceil(v.timeLeft)) : "";
    this.bannerText.textContent = turnBanner(v);

    // Rebuild the bars only when the content changes; this runs every frame.
    const sums = summarizeTeams(v);
    const key = JSON.stringify([sums, turnOrder(v)]);
    if (key !== this.shown) {
      this.shown = key;
      this.teams.replaceChildren();
      for (const t of sums) {
        const row = el("div", `h3-team${t.active ? " act" : ""}${t.out ? " out" : ""}`, this.teams);
        el("span", "", row, t.name);
        el("span", "", row, `${t.alive}/${t.total}`);
        const fill = el("div", "", el("div", "h3-bar", row));
        fill.style.width = `${t.fraction * 100}%`;
        fill.style.background = cssHex(v.teams[t.index]?.color ?? teamColor(t.index));
      }
      this.order.replaceChildren();
      turnOrder(v).forEach((i, n) => {
        const d = el("div", `h3-dot${n === 0 ? " act" : ""}`, this.order);
        d.style.background = cssHex(v.teams[i]?.color ?? teamColor(i));
        d.title = v.teams[i]?.name ?? "";
      });
    }

    const w = windStreamer(v.wind);
    this.arrow.style.transform = `rotate(${w.headingDeg - 90}deg) scale(${0.6 + w.strength * 0.7})`;
    this.windText.textContent =
      w.strength === 0 ? "calm" : `${Math.round(w.strength * 100)} ${compass(w.headingDeg)}`;

    this.cross.style.display = aim ? "block" : "none";
    this.power.style.display = aim ? "block" : "none";
    if (aim) {
      this.powerText.textContent = `${weapon ? `${weapon} · ` : ""}Power ${Math.round(aim.power)} · aim ${aim.pitchDeg}°`;
      this.powerFill.style.width = `${aim.power}%`;
    }
    this.hint.textContent = hint;
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
