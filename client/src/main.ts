import {
  carveCircle,
  fromFixed,
  hashTerrain,
  type MatchConfig,
  type SimEvent,
} from "@burrow-brawl/shared";
import * as THREE from "three";
import { audio } from "./audio";
import { PanZoomCamera } from "./camera";
import { FxSystem } from "./fx";
import { CritterViews } from "./game/critters";
import { localMatchConfig, matchConfigFromUrl } from "./game/config";
import { OnlineSource } from "./game/onlineSource";
import type { MatchSource } from "./game/source";
import { defaultLooks, looksFromRoom, type TeamLook } from "./game/teamLook";
import { GameHud } from "./game/gameHud";
import { GameInput } from "./game/input";
import { MatchRunner } from "./game/matchRunner";
import { ProjectileViews } from "./game/projectileView";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";
import { TerrainRenderer } from "./terrain/renderer";
import { mountUi } from "./ui";
import { MockClient } from "./ui/mockClient";

const app = document.getElementById("app")!;
const hudEl = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);
app.addEventListener("contextmenu", (e) => e.preventDefault());

const scene = buildScene();
const input = new GameInput();
const cam = new PanZoomCamera(renderer.domElement, 500);
// Visual FX: backdrop, animated soda, explosion particles, shake, damage popups (see fx/index.ts).
const fx = new FxSystem(scene, cam.camera, { sodaLevel: -1024, container: app });
const hud = new DebugHud(hudEl);
hudEl.style.display = "none";
const cursor = new THREE.Vector2();

// Aim indicator, soda plane: shared by every game. Soda: anything whose feet drop below the line
// is knocked out; the line rises in sudden death.
const aimLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  new THREE.LineBasicMaterial({ color: 0x3b2a1a }),
);
aimLine.visible = false;
scene.add(aimLine);

/** Everything that exists only while a match is on screen. */
interface Game {
  source: MatchSource;
  terrainRenderer: TerrainRenderer;
  critterViews: CritterViews;
  projectileViews: ProjectileViews;
  gameHud: GameHud;
  terrainHash: number;
  ended: boolean;
}
let game: Game | null = null;

function stopGame(): void {
  if (!game) return;
  scene.remove(game.terrainRenderer.group, game.critterViews.group, game.projectileViews.group);
  game.terrainRenderer.dispose();
  game.gameHud.dispose();
  game = null;
  aimLine.visible = false;
}

/** Show a match. `looks` names and colours each sim team; `onRematch` null hides "Play again". */
function startGame(source: MatchSource, looks: TeamLook[], onRematch: (() => void) | null): Game {
  stopGame();
  input.newTurn();
  const state = source.state;
  const terrainRenderer = new TerrainRenderer(state.sim.terrain);
  const critterViews = new CritterViews();
  critterViews.hats = looks.map((l) => l.hex);
  const projectileViews = new ProjectileViews();
  scene.add(terrainRenderer.group, critterViews.group, projectileViews.group);
  const gameHud = new GameHud(source.config, input, onRematch, looks, source.localTeams);
  const first = state.sim.critters.find((c) => c.id === state.turns.activeCritter);
  if (first)
    cam.camera.position.set(fromFixed(first.x), -fromFixed(first.y), cam.camera.position.z);
  game = {
    source,
    terrainRenderer,
    critterViews,
    projectileViews,
    gameHud,
    terrainHash: hashTerrain(state.sim.terrain),
    ended: false,
  };
  return game;
}

let carveRadius = 40;
let wireframe = false;
let debugVisible = false;

renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.copy(cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
});
// Debug carving (F3 shows the debug HUD): right-click or ctrl+click carves a circle. Hot-seat
// only: online, a local carve would desync from the server.
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
  if (!game || game.source.localTeams !== null) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const w = cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const t = game.source.state.sim.terrain;
  const res = carveCircle(t, Math.round(w.x), Math.round(-w.y), carveRadius);
  if (res.cellsRemoved > 0) game.terrainHash = hashTerrain(t);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "F3") {
    e.preventDefault();
    debugVisible = !debugVisible;
    hudEl.style.display = debugVisible ? "block" : "none";
  }
  if (e.key === "[") carveRadius = Math.max(4, carveRadius - 4);
  if (e.key === "]") carveRadius = Math.min(120, carveRadius + 4);
  if (e.key.toLowerCase() === "m") {
    wireframe = !wireframe;
    game?.terrainRenderer.setWireframe(wireframe);
  }
});
window.addEventListener("resize", () => {
  renderer.setSize(app.clientWidth, app.clientHeight);
  cam.resize();
});

/** One sound per kind of event, however many arrive in the same frame. */
function playSounds(events: readonly SimEvent[]): void {
  const kinds = new Set(events.map((e) => e.type));
  if (kinds.has("fired")) audio.play("fire");
  if (kinds.has("explosion")) audio.play("explosion");
  if (kinds.has("jumped")) audio.play("jump");
  if (kinds.has("landed")) audio.play("land");
  if (kinds.has("damage")) audio.play("damage");
}

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  cam.update(dt);
  if (game) drawGame(game, dt);
  fx.frame(dt, renderer, scene, cam.camera);
  requestAnimationFrame(frame);
}

function drawGame(g: Game, dt: number): void {
  const { source, terrainRenderer, critterViews, projectileViews, gameHud } = g;
  const tickEvents = source.advance(dt * 1000);
  const { sim, turns } = source.state;
  fx.onSimEvents(tickEvents, sim);
  playSounds(tickEvents);
  if (tickEvents.some((e) => e.type === "explosion")) g.terrainHash = hashTerrain(sim.terrain);
  if (!g.ended && turns.phase === "over") {
    g.ended = true;
    window.dispatchEvent(
      new CustomEvent("burrow:matchend", {
        detail: { winnerTeam: turns.winnerTeam, tick: sim.tick },
      }),
    );
  }

  const active = sim.critters.find((c) => c.id === turns.activeCritter);
  const controlling = turns.phase === "control" || turns.phase === "retreat";
  const myTurn =
    source.localTeams === null ||
    (turns.activeTeam !== null && source.localTeams.has(turns.activeTeam));
  if (active && myTurn) input.facing = active.facing;

  // Follow the active critter, then any shot in flight.
  const follow = sim.projectiles[0]
    ? { x: fromFixed(sim.projectiles[0].x), y: -fromFixed(sim.projectiles[0].y) }
    : active && controlling
      ? { x: fromFixed(active.x), y: -fromFixed(active.y) }
      : null;
  if (follow) {
    cam.camera.position.x += (follow.x - cam.camera.position.x) * Math.min(1, dt * 3);
    cam.camera.position.y += (follow.y - cam.camera.position.y) * Math.min(1, dt * 3);
  }

  terrainRenderer.setTerrain(sim.terrain);
  terrainRenderer.update();
  critterViews.sync(sim.critters, controlling ? turns.activeCritter : null, clock.elapsedTime);
  projectileViews.sync(sim.projectiles);
  fx.setSodaLevel(-sim.waterY);

  // The aim line shows only for the player who is aiming.
  aimLine.visible = !!active && active.status === "alive" && turns.phase === "control" && myTurn;
  if (active) {
    const a = (input.angle() * Math.PI) / 180; // display only; the sim uses integer tables
    const len = 20 + input.charge * 0.6;
    const ox = fromFixed(active.x);
    const oy = -fromFixed(active.y) + 12;
    aimLine.geometry.setFromPoints([
      new THREE.Vector3(ox, oy, 16),
      new THREE.Vector3(ox + Math.cos(a) * len, oy + Math.sin(a) * len, 16),
    ]);
  }

  gameHud.update(source.state);
  if (debugVisible) {
    hud.tick(dt);
    hud.render({
      camX: cam.camera.position.x,
      camY: cam.camera.position.y,
      viewHeight: cam.viewHeight,
      cursorX: cursor.x,
      cursorY: cursor.y,
      carveRadius,
      pendingChunks: terrainRenderer.pendingChunks,
      terrainHash: g.terrainHash,
      critter: active,
      tick: sim.tick,
      events: source.recentEvents,
      wind: sim.wind,
      weapon: input.weapon,
      elevation: input.elevation,
      charge: input.charge,
      fuse: input.fuseSeconds,
      projectiles: sim.projectiles.length,
    });
  }
}
requestAnimationFrame(frame);

// Modes: default is the lobby (online). ?nolobby or ?hotseat starts a local hot-seat match instead
// (config from the URL, see game/config.ts); ?mock uses a fake server.
const params = new URLSearchParams(location.search);

/** Start a hot-seat match on this computer: no server, no lobby. "Play again" reshuffles the map. */
function startLocal(config: MatchConfig): void {
  let lastTurn = -1;
  const runner = new MatchRunner(config, (state) => {
    const ts = state.turns;
    input.enabled = ts.phase === "control" || ts.phase === "retreat";
    if (ts.turn !== lastTurn) {
      lastTurn = ts.turn;
      input.newTurn();
    }
    return input.read();
  });
  startGame(runner, defaultLooks(config.teamSizes.length), () =>
    startLocal({ ...config, seed: crypto.getRandomValues(new Uint32Array(1))[0]! }),
  );
}

if (params.has("nolobby") || params.has("hotseat")) {
  startLocal(matchConfigFromUrl());
} else {
  const mock = params.has("mock");
  mountUi(document.body, {
    onClick: () => audio.play("uiClick"),
    // "Local play" on the title screen: hot-seat with no server.
    onLocalStart: ({ teams, size }) => startLocal(localMatchConfig(teams, size)),
    // The lobby hands us the network match when it starts (or when we rejoin one).
    onMatchStart: (client, net) => {
      if (!net.mirror) return;
      const source = new OnlineSource(client, net, input);
      startGame(source, looksFromRoom(client.room, net.teamIds), null);
    },
    onMatchEnd: () => {
      // The results overlay is the UI's; keep the final frame on screen behind it.
    },
    connect: mock
      ? async (nick) => {
          if (params.get("mock") === "slow") {
            await new Promise((r) => setTimeout(r, 6000));
            if (!sessionStorage.getItem("mockRetried")) {
              sessionStorage.setItem("mockRetried", "1");
              throw new Error("Could not reach the game server.");
            }
          }
          return new MockClient(nick);
        }
      : undefined,
  });
}
