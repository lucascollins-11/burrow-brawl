import type { MatchConfig, MatchState } from "@burrow-brawl/shared";
import { TICKS_PER_SECOND } from "@burrow-brawl/shared";
import { defaultLooks, type TeamLook } from "./teamLook";
import type { GameInput } from "./input";
import { WEAPONS } from "./input";

const STYLE = `
.bb-hud { position: fixed; inset: 0; pointer-events: none; font: 14px/1.3 system-ui, sans-serif; color: #3b2a1a; }
.bb-hud * { box-sizing: border-box; }
.bb-top { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center;
  padding: 8px 14px; background: rgba(255,248,235,.92); border: 3px solid #3b2a1a; border-radius: 14px; }
.bb-timer { font-size: 28px; font-weight: 700; min-width: 2.2ch; text-align: center; }
.bb-timer.low { color: #c0392b; }
.bb-turn { font-weight: 600; }
.bb-wind { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 110px; font-size: 12px; }
.bb-wind-bar { position: relative; width: 100px; height: 10px; background: #e6d3b8; border-radius: 5px; overflow: hidden; }
.bb-wind-fill { position: absolute; top: 0; bottom: 0; background: #4aa3df; }
.bb-wind-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #3b2a1a; }
.bb-teams { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 6px; }
.bb-team { min-width: 170px; padding: 5px 8px; background: rgba(255,248,235,.92); border: 2px solid #3b2a1a; border-radius: 10px; }
.bb-team.active { border-width: 4px; }
.bb-team.out { opacity: .45; }
.bb-team-name { display: flex; justify-content: space-between; font-weight: 600; }
.bb-bar { height: 10px; margin-top: 3px; background: #e6d3b8; border-radius: 5px; overflow: hidden; }
.bb-bar > div { height: 100%; }
.bb-weapons { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: stretch;
  padding: 8px; background: rgba(255,248,235,.92); border: 3px solid #3b2a1a; border-radius: 14px; pointer-events: auto; }
.bb-weapon { font: inherit; padding: 6px 12px; border: 2px solid #3b2a1a; border-radius: 10px; background: #fff; color: inherit; cursor: pointer; }
.bb-weapon.sel { background: #ffd23f; font-weight: 700; }
.bb-weapon:disabled { opacity: .5; cursor: default; }
.bb-power { width: 140px; display: flex; flex-direction: column; justify-content: center; gap: 3px; font-size: 12px; }
.bb-power .bb-bar { margin: 0; height: 14px; }
.bb-power .bb-bar > div { background: #e0805a; }
.bb-banner { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 10px;
  background: rgba(59,42,26,.55); color: #fff8eb; font-size: 40px; font-weight: 800; text-shadow: 0 3px 0 #3b2a1a; pointer-events: auto; }
.bb-banner button { font: inherit; font-size: 20px; padding: 8px 18px; border: 3px solid #3b2a1a; border-radius: 12px; background: #ffd23f; color: #3b2a1a; cursor: pointer; }
.bb-help { position: absolute; bottom: 10px; left: 8px; font-size: 11px; background: rgba(255,248,235,.8); padding: 4px 8px; border-radius: 8px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

const hexCss = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

/** Game HUD: turn timer, wind, per-team health, weapon picker, power bar, win banner. Plain DOM. */
export class GameHud {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly windFill: HTMLElement;
  private readonly windText: HTMLElement;
  private readonly teams: HTMLElement[] = [];
  private readonly teamBars: HTMLElement[] = [];
  private readonly teamTexts: HTMLElement[] = [];
  private readonly weaponButtons: HTMLButtonElement[] = [];
  private readonly skipButton: HTMLButtonElement;
  private readonly powerFill: HTMLElement;
  private readonly powerText: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;

  constructor(
    private readonly config: MatchConfig,
    private readonly input: GameInput,
    onRematch: (() => void) | null,
    /** How each sim team is named and coloured; defaults to the four stock hat colours. */
    private readonly looks: readonly TeamLook[] = defaultLooks(config.teamSizes.length),
    /** Online: sim team indexes this player controls. Null in hot-seat (everyone shares the keyboard). */
    private readonly localTeams: ReadonlySet<number> | null = null,
  ) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = el("div", "bb-hud");
    document.body.appendChild(this.root);

    const top = el("div", "bb-top", this.root);
    this.timer = el("div", "bb-timer", top);
    this.turn = el("div", "bb-turn", top);
    const wind = el("div", "bb-wind", top);
    this.windText = el("div", "", wind);
    const bar = el("div", "bb-wind-bar", wind);
    this.windFill = el("div", "bb-wind-fill", bar);
    el("div", "bb-wind-mid", bar);

    const teams = el("div", "bb-teams", this.root);
    config.teamSizes.forEach((_, i) => {
      const t = el("div", "bb-team", teams);
      t.style.borderColor = hexCss(this.looks[i]?.hex ?? 0);
      const name = el("div", "bb-team-name", t);
      const label = el("span", "", name);
      label.textContent = this.looks[i]?.name ?? `Team ${i + 1}`;
      this.teamTexts.push(el("span", "", name));
      const b = el("div", "bb-bar", t);
      const fill = el("div", "", b);
      fill.style.background = hexCss(this.looks[i]?.hex ?? 0);
      this.teams.push(t);
      this.teamBars.push(fill);
    });

    const weapons = el("div", "bb-weapons", this.root);
    for (const w of WEAPONS) {
      const b = el("button", "bb-weapon", weapons);
      b.textContent = `${w.key}  ${w.name}`;
      b.addEventListener("click", () => input.pick(w.id));
      this.weaponButtons.push(b);
    }
    const power = el("div", "bb-power", weapons);
    this.powerText = el("div", "", power);
    const pb = el("div", "bb-bar", power);
    this.powerFill = el("div", "", pb);
    this.skipButton = el("button", "bb-weapon", weapons);
    this.skipButton.textContent = "Skip turn";
    this.skipButton.addEventListener("click", () => input.skip());

    const help = el("div", "bb-help", this.root);
    help.textContent =
      "A/D walk · Space jump · Enter backflip · W/S aim · hold F to charge, release to fire · 1/2 weapon · Z/X fuse · Backspace skip";

    this.banner = el("div", "bb-banner", this.root);
    this.bannerText = el("div", "", this.banner);
    if (onRematch) {
      const again = el("button", "", this.banner);
      again.textContent = "Play again";
      again.addEventListener("click", onRematch);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  update(state: MatchState): void {
    const ts = state.turns;
    const tick = state.sim.tick;
    const secs = Math.ceil(Math.max(0, ts.phaseEndTick - tick) / TICKS_PER_SECOND);
    const controlling = ts.phase === "control" || ts.phase === "retreat";
    this.timer.textContent = ts.phase === "over" ? "" : String(secs);
    this.timer.classList.toggle("low", controlling && secs <= 5);
    const teamName = (i: number | null): string =>
      i === null ? "" : (this.looks[i]?.name ?? `Team ${i + 1}`);
    const mine = ts.activeTeam !== null && this.localTeams?.has(ts.activeTeam) === true;
    this.turn.textContent =
      ts.phase === "over"
        ? "Match over"
        : `Round ${ts.round} · ${mine ? "YOUR TURN" : teamName(ts.activeTeam)}${ts.phase === "retreat" ? " (retreat!)" : ts.phase === "settling" ? " (waiting)" : ""}`;

    const max = Math.max(1, this.config.windMax);
    const pct = (Math.abs(ts.wind) / max) * 50;
    this.windFill.style.width = `${pct}%`;
    this.windFill.style.left = ts.wind >= 0 ? "50%" : `${50 - pct}%`;
    this.windText.textContent = `Wind ${ts.wind < 0 ? "◀" : ts.wind > 0 ? "▶" : "·"} ${Math.abs(ts.wind)}`;

    this.config.teamSizes.forEach((size, i) => {
      let hp = 0;
      let alive = 0;
      for (const c of state.sim.critters) {
        if (c.team !== i) continue;
        if (c.status === "alive") {
          hp += c.hp;
          alive++;
        }
      }
      const total = size * this.config.startHealth;
      this.teamBars[i]!.style.width = `${(hp / total) * 100}%`;
      this.teamTexts[i]!.textContent = `${alive}/${size} · ${hp} hp`;
      this.teams[i]!.classList.toggle("active", ts.activeTeam === i && ts.phase !== "over");
      this.teams[i]!.classList.toggle("out", alive === 0);
    });

    WEAPONS.forEach((w, i) => {
      this.weaponButtons[i]!.classList.toggle("sel", this.input.weapon === w.id);
      this.weaponButtons[i]!.disabled =
        ts.phase !== "control" || (this.localTeams !== null && !mine);
    });
    this.skipButton.disabled = !controlling || (this.localTeams !== null && !mine);
    this.powerFill.style.width = `${this.input.charge}%`;
    this.powerText.textContent =
      this.input.weapon === "fizz-grenade"
        ? `Power ${Math.round(this.input.charge)} · fuse ${this.input.fuseSeconds}s · aim ${this.input.elevation}°`
        : `Power ${Math.round(this.input.charge)} · aim ${this.input.elevation}°`;

    if (ts.phase === "over") {
      this.bannerText.textContent =
        ts.winnerTeam === null ? "Draw!" : `${teamName(ts.winnerTeam)} wins!`;
      this.banner.style.display = "flex";
    } else {
      this.banner.style.display = "none";
    }
  }
}
