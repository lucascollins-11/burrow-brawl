import { carveCircle, createDemoTerrain, hashTerrain } from "@burrow-brawl/shared";
import * as THREE from "three";
import { PanZoomCamera } from "./camera";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";
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
  });
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
