import * as THREE from "three";
import { audio } from "./audio";
import { matchConfigFromUrl } from "./game/config";
import { MatchRunner } from "./game/matchRunner";
import { OnlineSource } from "./game/onlineSource";
import type { MatchSource } from "./game/source";
import { defaultLooks, looksFromRoom, type TeamLook } from "./game/teamLook";
import { Controls3D } from "./game3d/controls";
import { Environment } from "./game3d/environment";
import { Game3D } from "./game3d/game3d";
import { Input3D } from "./game3d/input3d";
import { mountUi } from "./ui";
import { MockClient } from "./ui/mockClient";

const app = document.getElementById("app")!;
document.getElementById("hud")?.remove();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, app.clientWidth / app.clientHeight, 0.5, 3000);
const stage = { scene, camera, container: app };
const raw = new Input3D(renderer.domElement);
raw.active = false;
const controls = new Controls3D(raw);

// Behind the menus: the empty soda sea with a slowly turning camera.
let backdrop: Environment | null = new Environment(scene, 26);
let game: Game3D | null = null;

function stopGame(): void {
  game?.dispose();
  game = null;
  raw.active = false;
  backdrop ??= new Environment(scene, 26);
}

/** Show a match. `looks` names and colours each sim team; `onRematch` null hides "Play again". */
function startGame(source: MatchSource, looks: TeamLook[], onRematch: (() => void) | null): void {
  stopGame();
  backdrop?.dispose();
  backdrop = null;
  raw.active = true;
  game = new Game3D(stage, source, looks, controls, onRematch);
}

window.addEventListener("resize", () => {
  renderer.setSize(app.clientWidth, app.clientHeight);
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (game) game.frame(dt);
  else if (backdrop) {
    const a = clock.elapsedTime * 0.05;
    camera.position.set(128 + Math.cos(a) * 260, 90, 128 + Math.sin(a) * 260);
    camera.lookAt(128, 30, 128);
    backdrop.update(dt, { x: 30, z: -20 });
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For debugging and browser tests: the match state currently on screen.
(window as unknown as { __bb: unknown }).__bb = { state: () => game?.source.state ?? null };

// Modes: default is the lobby (online). ?nolobby or ?hotseat starts a local hot-seat match instead
// (config from the URL, see game/config.ts); ?mock uses a fake server.
const params = new URLSearchParams(location.search);
if (params.has("nolobby") || params.has("hotseat")) {
  const config = matchConfigFromUrl();
  let lastTurn = -1;
  const runner = new MatchRunner(config, (state) => {
    const ts = state.turns;
    controls.enabled = ts.phase === "control" || ts.phase === "retreat";
    if (ts.turn !== lastTurn) {
      lastTurn = ts.turn;
      controls.newTurn();
    }
    return controls.read();
  });
  startGame(runner, defaultLooks(config.teamSizes.length), () => {
    const q = new URLSearchParams(window.location.search);
    q.set("seed", String(crypto.getRandomValues(new Uint32Array(1))[0]));
    window.location.search = q.toString();
  });
} else {
  const mock = params.has("mock");
  mountUi(document.body, {
    onClick: () => audio.play("uiClick"),
    // The lobby hands us the network match when it starts (or when we rejoin one).
    onMatchStart: (client, net) => {
      if (!net.mirror) return;
      const source = new OnlineSource(client, net, controls);
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
