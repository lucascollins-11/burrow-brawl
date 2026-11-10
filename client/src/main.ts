import * as THREE from "three";
import { PanZoomCamera } from "./camera";
import { DebugHud } from "./hud";
import { buildScene } from "./scene";

const app = document.getElementById("app")!;
const hudEl = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);
app.addEventListener("contextmenu", (e) => e.preventDefault());

const scene = buildScene();
const cam = new PanZoomCamera(renderer.domElement);
const hud = new DebugHud(hudEl);
const cursor = new THREE.Vector2();

renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.copy(cam.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
});
window.addEventListener("resize", () => {
  renderer.setSize(app.clientWidth, app.clientHeight);
  cam.resize();
});

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  cam.update(dt);
  const cube = scene.getObjectByName("test-cube");
  if (cube) cube.rotation.y += dt;
  hud.tick(dt);
  hud.render({
    camX: cam.camera.position.x,
    camY: cam.camera.position.y,
    viewHeight: cam.viewHeight,
    cursorX: cursor.x,
    cursorY: cursor.y,
  });
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
