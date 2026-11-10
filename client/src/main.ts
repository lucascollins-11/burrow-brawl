import {
  carveCircle,
  cloneTerrain,
  createCritter,
  createDemoTerrain,
  createWorld,
  findSurfaceY,
  fromFixed,
  hashTerrain,
} from "@burrow-brawl/shared";
import * as THREE from "three";
import { audio } from "./audio";
import { PanZoomCamera } from "./camera";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";
import { CritterViews } from "./sim/critterView";
import { ProjectileViews } from "./sim/projectileView";
import { SimInput } from "./sim/input";
import { SimRunner } from "./sim/runner";
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
const terrain = createDemoTerrain();
const terrainRenderer = new TerrainRenderer(terrain);
scene.add(terrainRenderer.group);
const spawnXs = [500, 1500];
const critters = spawnXs.map((x, i) => createCritter(i + 1, i, x, findSurfaceY(terrain, x)));
const simInput = new SimInput();
let activeId = 1;
const runner: SimRunner = new SimRunner(createWorld(terrain, critters, terrain.height - 40), () => [
  simInput.read(activeId, activeCritter()?.facing ?? 1),
]);
function activeCritter() {
  return runner.state.critters.find((c) => c.id === activeId);
}
const critterViews = new CritterViews();
const projectileViews = new ProjectileViews();
scene.add(projectileViews.group);

// Aim indicator: a short line from the active critter along the aim direction.
const aimLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  new THREE.LineBasicMaterial({ color: 0x3b2a1a }),
);
scene.add(aimLine);
scene.add(critterViews.group);

// Soda line: anything whose feet drop below it is knocked out.
const soda = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 400),
  new THREE.MeshBasicMaterial({ color: 0xff8fb8, transparent: true, opacity: 0.55 }),
);
soda.position.set(1024, -runner.state.waterY - 200, 20);
scene.add(soda);

let carveRadius = 40;
let wireframe = false;
let terrainHash = hashTerrain(runner.state.terrain);
const cam = new PanZoomCamera(renderer.domElement);
const hud = new DebugHud(hudEl);
const cursor = new THREE.Vector2();

renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.copy(cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
});
// Debug carving: right-click (or ctrl+click) carves a circle. [ and ] change the radius, M toggles wireframe.
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const w = cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  // Copy on write, like explosions in the sim: never mutate the terrain a state already points at.
  const next = cloneTerrain(runner.state.terrain);
  const res = carveCircle(next, Math.round(w.x), Math.round(-w.y), carveRadius);
  if (res.cellsRemoved > 0) {
    runner.state = { ...runner.state, terrain: next };
    terrainHash = hashTerrain(next);
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    activeId = activeId === 1 ? 2 : 1;
  }
  if (e.key === ",")
    runner.state = { ...runner.state, wind: Math.max(-100, runner.state.wind - 10) };
  if (e.key === ".")
    runner.state = { ...runner.state, wind: Math.min(100, runner.state.wind + 10) };
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

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  cam.update(dt);
  const tickEvents = runner.advance(dt * 1000);
  if (tickEvents.some((e) => e.type === "explosion"))
    terrainHash = hashTerrain(runner.state.terrain);
  critterViews.sync(runner.state.critters, activeId);
  projectileViews.sync(runner.state.projectiles);
  const ac = activeCritter();
  aimLine.visible = ac?.status === "alive";
  if (ac) {
    const a = (simInput.angleFor(ac.facing) * Math.PI) / 180; // display only; the sim uses integer tables
    const len = 20 + simInput.charge * 0.6;
    const ox = fromFixed(ac.x);
    const oy = -fromFixed(ac.y) + 12;
    aimLine.geometry.setFromPoints([
      new THREE.Vector3(ox, oy, 16),
      new THREE.Vector3(ox + Math.cos(a) * len, oy + Math.sin(a) * len, 16),
    ]);
  }
  terrainRenderer.setTerrain(runner.state.terrain);
  terrainRenderer.update();
  const cube = scene.getObjectByName("test-cube");
  if (cube) cube.rotation.y += dt;
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
    critter: runner.state.critters.find((c) => c.id === activeId),
    tick: runner.state.tick,
    events: runner.recentEvents,
    wind: runner.state.wind,
    weapon: simInput.weapon,
    elevation: simInput.elevation,
    charge: simInput.charge,
    fuse: simInput.fuseSeconds,
    projectiles: runner.state.projectiles.length,
  });
  renderer.render(scene, cam.camera);
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
