import * as THREE from "three";
import {
  AIM_DIST,
  aimDirection,
  chargeAim,
  cameraYawForHeading,
  clamp,
  degToYaw,
  dragOrbit,
  headingOf,
  initialRig,
  moveRelativeToCamera,
  newAim,
  nudgeAim,
  ORBIT_LIMITS,
  rigPosition,
  stepRig,
  yawToDeg,
  zoom,
  type AimState,
  type RigGoal,
  type RigState,
} from "./cameraRig";
import { Effects3D } from "./effects3d";
import { Environment } from "./environment";
import { buildFakeTerrain, FAKE_SEA_Y, heightAt, WORLD } from "./fakeWorld";
import { Hud3D } from "./hud3d";
import { Input3D } from "./input3d";
import { animateMolekin, createMolekin3D } from "./molekin3d";
import { defaultHat } from "./teamColors";
import { TEAM_COLORS_3D } from "./teamColors";
import { CRITTER_HEIGHT, MAX_TEAMS, type CritterView, type ViewState } from "./viewState";

// 3D sandbox against a fake world and a fake driver (no sim3d yet): walk the active critter with WASD
// relative to the camera, Tab for aim mode, hold F to charge and release to fire a shell that the camera
// follows to the blast, then the next team's turn. It exists to prove the camera, rendering and HUD.

const WALK_SPEED = 14; // voxels per second
const SHELL_SPEED = 90;
const GRAVITY = 55;
const BLAST_RADIUS = 9;
const TURN_SECONDS = 45;

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export function startSandbox3D(): void {
  const params = new URLSearchParams(location.search);
  const teamCount = clamp(Number(params.get("teams")) || 4, 2, MAX_TEAMS);
  const size = clamp(Number(params.get("size")) || 2, 1, 4);

  const app = document.getElementById("app")!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(app.clientWidth, app.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, app.clientWidth / app.clientHeight, 0.5, 3000);
  const env = new Environment(scene, FAKE_SEA_Y);
  env.placeStreamers(heightAt);
  const terrain = buildFakeTerrain();
  scene.add(terrain);
  const fx = new Effects3D(app);
  scene.add(fx.group);
  const input = new Input3D(renderer.domElement);
  const hud = new Hud3D(document.body);

  // Critters on the island, spread around a ring on dry land.
  const critters: (CritterView & { mesh: THREE.Group })[] = [];
  const teams = Array.from({ length: teamCount }, (_, i) => ({
    index: i,
    name: TEAM_COLORS_3D[i]!.name,
    hat: defaultHat(i),
  }));
  let id = 1;
  for (let n = 0; n < size; n++)
    for (let t = 0; t < teamCount; t++) {
      const a = ((t + n * 0.5) / teamCount) * Math.PI * 2 + n * 0.35;
      const r = 40 + n * 22;
      const x = WORLD.w / 2 + Math.cos(a) * r;
      const z = WORLD.d / 2 + Math.sin(a) * r;
      const mesh = createMolekin3D(t, teams[t]!.hat);
      mesh.position.set(x, heightAt(x, z), z);
      scene.add(mesh);
      critters.push({
        id: id++,
        team: t,
        name: `Mole ${id - 1}`,
        x,
        y: heightAt(x, z),
        z,
        headingDeg: 0,
        hp: 100,
        maxHp: 100,
        alive: true,
        mesh,
      });
    }

  const wind = { x: 30, z: -20 };
  let activeId = critters[0]!.id;
  let phase: ViewState["phase"] = "control";
  let timeLeft = TURN_SECONDS;
  let round = 1;
  let aim: AimState | null = null;
  let shell: Shell | null = null;
  let blast: THREE.Vector3 | null = null;
  let settleTimer = 0;
  let rig: RigState = initialRig();
  const act = () => critters.find((c) => c.id === activeId)!;
  rig.target = { x: act().x, y: act().y + 3, z: act().z };

  function nextTurn(): void {
    const alive = critters.filter((c) => c.alive);
    const cur = act();
    const order = [...alive].sort((a, b) => a.team - b.team || a.id - b.id);
    // Next critter of the next team that still has someone alive.
    const nextTeam = order.map((c) => c.team).find((t) => t > cur.team) ?? order[0]!.team;
    if (nextTeam <= cur.team) round++;
    const pool = order.filter((c) => c.team === nextTeam);
    activeId = (pool.find((c) => c.id > cur.id) ?? pool[0]!).id;
    phase = "control";
    timeLeft = TURN_SECONDS;
    aim = null;
    input.setAiming(false);
    wind.x = Math.round((Math.random() * 2 - 1) * 80);
    wind.z = Math.round((Math.random() * 2 - 1) * 80);
  }

  function fire(): void {
    if (!aim) return;
    const c = act();
    const d = aimDirection(aim);
    const speed = SHELL_SPEED * (0.2 + (aim.power / 100) * 0.8);
    shell = {
      pos: new THREE.Vector3(c.x, c.y + CRITTER_HEIGHT * 0.7, c.z).addScaledVector(
        new THREE.Vector3(d.x, d.y, d.z),
        3,
      ),
      vel: new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(speed),
    };
    phase = "retreat";
    aim = null;
    input.setAiming(false);
  }

  function explode(at: THREE.Vector3): void {
    blast = at.clone();
    fx.explode(at.x, at.y, at.z, BLAST_RADIUS);
    for (const c of critters) {
      if (!c.alive) continue;
      const dist = Math.hypot(c.x - at.x, c.y + 3 - at.y, c.z - at.z);
      if (dist < BLAST_RADIUS + 2) {
        const dmg = Math.round(40 * (1 - dist / (BLAST_RADIUS + 2)));
        if (dmg > 0) {
          const i = critters.indexOf(c);
          const hp = Math.max(0, c.hp - dmg);
          critters[i] = { ...c, hp, alive: hp > 0 };
          fx.damage(c.x, c.y + CRITTER_HEIGHT, c.z, dmg);
          if (hp <= 0) critters[i]!.mesh.visible = false;
        }
      }
    }
    shell = null;
    settleTimer = 1.6;
    phase = "settling";
  }

  const clock = new THREE.Clock();
  const viewState = (): ViewState => ({
    teams,
    critters,
    projectiles: shell
      ? [{ id: 1, kind: "shell", x: shell.pos.x, y: shell.pos.y, z: shell.pos.z }]
      : [],
    activeCritterId: activeId,
    activeTeam: act().team,
    phase,
    round,
    timeLeft,
    wind,
    seaY: FAKE_SEA_Y,
    winnerTeam: null,
  });

  const shellMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b }),
  );
  shellMesh.castShadow = true;
  shellMesh.visible = false;
  scene.add(shellMesh);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(1, 2.4, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  );
  marker.rotation.x = Math.PI;
  scene.add(marker);

  function frame(): void {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const inp = input.consume();
    const me = act();
    const controlling = phase === "control";

    for (const a of inp.actions) {
      if (!controlling) continue;
      if (a === "toggleAim") {
        if (aim) {
          aim = null;
          input.setAiming(false);
        } else {
          aim = newAim(me.headingDeg);
          input.setAiming(true);
        }
      }
      if (a === "cancelAim" && aim) {
        aim = null;
        input.setAiming(false);
      }
      if (a === "skip") nextTurn();
      if (a === "fireDown") {
        if (!aim) {
          aim = newAim(me.headingDeg);
          input.setAiming(true);
        }
        aim = { ...aim, charging: true, power: 0 };
      }
      if (a === "fireUp" && aim?.charging) fire();
    }

    // Camera input: drag orbits (or turns the crosshair in aim mode); the wheel zooms.
    if (aim && controlling) aim = nudgeAim(aim, inp.dx, inp.dy);
    else rig = dragOrbit(rig, inp.dx, inp.dy);
    rig = zoom(rig, inp.wheel);

    // WASD walks the active critter relative to the camera; in aim mode it is off.
    if (controlling && !aim) {
      const { forward, right } = input.axes();
      const dir = moveRelativeToCamera(rig.yawDeg, forward, right);
      if (dir) {
        const i = critters.findIndex((c) => c.id === activeId);
        const nx = clamp(me.x + dir.x * WALK_SPEED * dt, 4, WORLD.w - 4);
        const nz = clamp(me.z + dir.z * WALK_SPEED * dt, 4, WORLD.d - 4);
        const ny = heightAt(nx, nz);
        if (ny > FAKE_SEA_Y - 1 && ny - me.y < 3) {
          critters[i] = { ...me, x: nx, y: ny, z: nz, headingDeg: headingOf(dir) };
          me.mesh.position.set(nx, ny, nz);
        }
      }
    }
    if (aim) aim = chargeAim(aim, dt);

    if (controlling) {
      timeLeft -= dt;
      if (timeLeft <= 0) nextTurn();
    }
    if (shell) {
      shell.vel.x += wind.x * 0.05 * dt;
      shell.vel.z += wind.z * 0.05 * dt;
      shell.vel.y -= GRAVITY * dt;
      shell.pos.addScaledVector(shell.vel, dt);
      if (shell.pos.y <= heightAt(shell.pos.x, shell.pos.z) || shell.pos.y < FAKE_SEA_Y - 2)
        explode(shell.pos);
    }
    if (phase === "settling") {
      settleTimer -= dt;
      if (settleTimer <= 0) {
        blast = null;
        nextTurn();
      }
    }

    // Critters face where they walk; the active one bobs.
    for (const c of critters) {
      c.mesh.rotation.y = (c.headingDeg * Math.PI) / 180;
      animateMolekin(c.mesh, t, c.id === activeId);
    }
    const cur = act();
    if (aim) cur.mesh.rotation.y = (yawToDeg(aim.yaw) * Math.PI) / 180;
    marker.position.set(cur.x, cur.y + CRITTER_HEIGHT + 3.5 + Math.sin(t * 4) * 0.4, cur.z);
    marker.visible = phase === "control";
    shellMesh.visible = !!shell;
    if (shell) shellMesh.position.copy(shell.pos);

    // Camera goal by situation: follow the shell, then the blast, aim behind the shoulder, else orbit.
    let goal: RigGoal;
    if (shell)
      goal = {
        mode: "follow",
        target: { x: shell.pos.x, y: shell.pos.y, z: shell.pos.z },
        dist: 38,
      };
    else if (blast)
      goal = { mode: "follow", target: { x: blast.x, y: blast.y, z: blast.z }, dist: 42 };
    else if (aim) {
      const d = aimDirection(aim);
      goal = {
        mode: "aim",
        target: {
          x: cur.x + d.x * 22,
          y: cur.y + CRITTER_HEIGHT * 0.8 + d.y * 22,
          z: cur.z + d.z * 22,
        },
        yawDeg: cameraYawForHeading(yawToDeg(aim.yaw)),
        pitchDeg: -aim.pitchDeg,
        dist: AIM_DIST + 22,
      };
    } else {
      goal = {
        mode: "orbit",
        target: { x: cur.x, y: cur.y + CRITTER_HEIGHT * 0.6, z: cur.z },
        pitchDeg: clamp(rig.pitchDeg, ORBIT_LIMITS.minPitch, ORBIT_LIMITS.maxPitch),
        dist: clamp(rig.dist, ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist),
      };
    }
    rig = stepRig(rig, goal, dt);
    const p = rigPosition(rig);
    // Never let the camera sink under the ground.
    p.y = Math.max(p.y, heightAt(p.x, p.z) + 2.5);
    fx.update(dt, camera);
    camera.position.set(p.x, p.y, p.z).add(fx.shakeOffset);
    camera.lookAt(rig.target.x, rig.target.y, rig.target.z);

    env.update(dt, wind);
    const v = viewState();
    hud.update(
      v,
      aim,
      aim
        ? "Mouse aims · hold F to charge, release to fire · Tab/Esc leaves aim"
        : "Drag to look · wheel zooms · WASD walks · Tab aims · Backspace skips",
    );
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  addEventListener("resize", () => {
    renderer.setSize(app.clientWidth, app.clientHeight);
    camera.aspect = app.clientWidth / app.clientHeight;
    camera.updateProjectionMatrix();
  });
  void degToYaw;
}
