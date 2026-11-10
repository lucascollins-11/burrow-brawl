import {
  carveCircle,
  createCritter,
  createDemoTerrain,
  createWorld,
  findSurfaceY,
  hashTerrain,
} from "@burrow-brawl/shared";
import * as THREE from "three";
import { PanZoomCamera } from "./camera";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";
import { CritterViews } from "./sim/critterView";
import { SimInput } from "./sim/input";
import { SimRunner } from "./sim/runner";
import { TerrainRenderer } from "./terrain/renderer";

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
const runner = new SimRunner(createWorld(terrain, critters, terrain.height - 40), () => [
  simInput.read(activeId),
]);
const critterViews = new CritterViews();
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
let terrainHash = hashTerrain(terrain);
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
  const res = carveCircle(terrain, Math.round(w.x), Math.round(-w.y), carveRadius);
  if (res.cellsRemoved > 0) terrainHash = hashTerrain(terrain);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    activeId = activeId === 1 ? 2 : 1;
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

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  cam.update(dt);
  runner.advance(dt * 1000);
  critterViews.sync(runner.state.critters, activeId);
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
  });
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
