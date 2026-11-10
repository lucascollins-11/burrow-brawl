import { carveCircle, fromFixed, hashTerrain } from "@burrow-brawl/shared";
import * as THREE from "three";
import { audio } from "./audio";
import { PanZoomCamera } from "./camera";
import { FxSystem } from "./fx";
import { CritterViews } from "./game/critters";
import { matchConfigFromUrl } from "./game/config";
import { GameHud } from "./game/gameHud";
import { GameInput } from "./game/input";
import { MatchRunner } from "./game/matchRunner";
import { ProjectileViews } from "./game/projectileView";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";
import { TerrainRenderer } from "./terrain/renderer";
import { mountUi } from "./ui";
import { shakeFor } from "./ui/settings";
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
const config = matchConfigFromUrl();

// Hot-seat match: same createMatch/stepMatch path the online match uses.
let lastTurn = -1;
const runner = new MatchRunner(config, (state) => {
  const ts = state.turns;
  const controlling = ts.phase === "control" || ts.phase === "retreat";
  input.enabled = controlling;
  if (ts.turn !== lastTurn) {
    lastTurn = ts.turn;
    input.newTurn();
  }
  return input.read();
});

// UI hook: the win screen can listen for `window` "burrow:matchend" (detail: MatchEndInfo).
runner.onMatchEnd = (info) =>
  window.dispatchEvent(new CustomEvent("burrow:matchend", { detail: info }));

const terrainRenderer = new TerrainRenderer(runner.state.sim.terrain);
scene.add(terrainRenderer.group);
const critterViews = new CritterViews();
scene.add(critterViews.group);
const projectileViews = new ProjectileViews();
scene.add(projectileViews.group);

// Aim indicator: a short line from the active critter along the aim direction.
const aimLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  new THREE.LineBasicMaterial({ color: 0x3b2a1a }),
);
scene.add(aimLine);

const gameHud = new GameHud(config, input, () => {
  const q = new URLSearchParams(window.location.search);
  q.set("seed", String(crypto.getRandomValues(new Uint32Array(1))[0]));
  window.location.search = q.toString();
});

let carveRadius = 40;
let wireframe = false;
let debugVisible = false;
let terrainHash = hashTerrain(runner.state.sim.terrain);
const cam = new PanZoomCamera(renderer.domElement, 500);
// Visual FX: backdrop, animated soda, explosion particles, shake, damage popups (see fx/index.ts).
const fx = new FxSystem(scene, cam.camera, { sodaLevel: -runner.state.sim.waterY, container: app });
const hud = new DebugHud(hudEl);
hudEl.style.display = "none";
const cursor = new THREE.Vector2();

renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.copy(cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
});
// Debug carving (F3 shows the debug HUD): right-click or ctrl+click carves a circle.
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const w = cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const t = runner.state.sim.terrain;
  const res = carveCircle(t, Math.round(w.x), Math.round(-w.y), carveRadius);
  if (res.cellsRemoved > 0) terrainHash = hashTerrain(t);
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
    terrainRenderer.setWireframe(wireframe);
  }
});
window.addEventListener("resize", () => {
  renderer.setSize(app.clientWidth, app.clientHeight);
  cam.resize();
});

// Start framed on the first active critter.
{
  const first = runner.state.sim.critters.find((c) => c.id === runner.state.turns.activeCritter);
  if (first)
    cam.camera.position.set(fromFixed(first.x), -fromFixed(first.y), cam.camera.position.z);
}

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  const tickEvents = runner.advance(dt * 1000);
  const { sim, turns } = runner.state;
  fx.onSimEvents(tickEvents, sim);
  if (tickEvents.some((e) => e.type === "explosion")) terrainHash = hashTerrain(sim.terrain);

  const active = sim.critters.find((c) => c.id === turns.activeCritter);
  const controlling = turns.phase === "control" || turns.phase === "retreat";
  if (active) input.facing = active.facing;

  cam.update(dt);
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

  aimLine.visible = !!active && active.status === "alive" && turns.phase === "control";
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

  gameHud.update(runner.state);
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
      terrainHash,
      critter: active,
      tick: sim.tick,
      events: runner.recentEvents,
      wind: sim.wind,
      weapon: input.weapon,
      elevation: input.elevation,
      charge: input.charge,
      fuse: input.fuseSeconds,
      projectiles: sim.projectiles.length,
    });
  }
  fx.frame(dt, renderer, scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Lobby overlay. Add ?nolobby to the URL to go straight to the debug scene, ?mock for a fake server
// (?mock=slow also simulates a cold-starting server: it waits, fails once, then works).
const params = new URLSearchParams(location.search);
if (!params.has("nolobby")) {
  const mock = params.has("mock");
  mountUi(document.body, {
    onClick: () => audio.play("uiClick"),
    audio,
    onSettingsChange: (s) => (fx.shake.maxOffset = shakeFor(s)),
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
