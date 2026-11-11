import * as THREE from "three";
import { topSolidY, type SimEvent, type VoxelTerrain } from "@burrow-brawl/shared";
import { audio } from "../audio";
import type { MatchSource } from "../game/source";
import type { TeamLook } from "../game/teamLook";
import { TerrainMeshes } from "../terrain3d/terrainMeshes";
import {
  AIM_DIST,
  aimDirection,
  cameraYawForHeading,
  clamp,
  dragOrbit,
  initialRig,
  ORBIT_LIMITS,
  rigPosition,
  stepRig,
  yawToDeg,
  zoom,
  type RigGoal,
  type RigState,
  type Vec3,
} from "./cameraRig";
import type { Controls3D } from "./controls";
import { Effects3D } from "./effects3d";
import { Environment } from "./environment";
import { Hud3D } from "./hud3d";
import { animateMolekin, createMolekin3D } from "./molekin3d";
import { defaultHat } from "./teamColors";
import { viewFromMatch } from "./viewAdapter";
import { CRITTER_HEIGHT, type TeamView, type ViewState } from "./viewState";

export interface Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Element the canvas fills; damage numbers are positioned inside it. */
  readonly container: HTMLElement;
}

const HINT_WALK =
  "Drag to look · wheel zooms · WASD walks · Space jumps · Tab or F aims · 1/2 weapon · Backspace skips";
const HINT_AIM = "Mouse aims · hold F to charge, release to fire · Z/X fuse · Tab/Esc leaves aim";
const HINT_WATCH = "Drag to look · wheel zooms";
/** How long the camera stays on a blast before going back to the next critter. */
const BLAST_HOLD_S = 1.4;

/** One match on screen: terrain, critters, shots, camera, HUD and effects, drawn from a MatchSource. */
export class Game3D {
  private readonly env: Environment;
  private readonly meshes = new TerrainMeshes();
  private readonly fx: Effects3D;
  private readonly hud: Hud3D;
  private readonly teams: TeamView[];
  private readonly critters = new Map<number, THREE.Group>();
  private readonly shots = new Map<number, THREE.Mesh>();
  private readonly marker: THREE.Mesh;
  private readonly again: HTMLButtonElement | null = null;
  private terrain: VoxelTerrain | undefined;
  private rig: RigState = initialRig();
  private blast: { at: Vec3; left: number } | null = null;
  private time = 0;
  private ended = false;

  constructor(
    private readonly stage: Stage,
    readonly source: MatchSource,
    looks: readonly TeamLook[],
    private readonly controls: Controls3D,
    onRematch: (() => void) | null,
  ) {
    const { sim, turns } = source.state;
    const t = sim.terrain;
    this.teams = looks.map((l, i) => ({
      index: i,
      name: l.name,
      hat: defaultHat(i),
      color: l.hex,
    }));
    this.env = new Environment(stage.scene, sim.seaY, { w: t.sizeX, d: t.sizeZ });
    this.env.placeStreamers((x, z) => Math.max(sim.seaY, this.groundY(t, x, z)));
    this.fx = new Effects3D(stage.container);
    this.hud = new Hud3D(document.body);
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(1, 2.4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    );
    this.marker.rotation.x = Math.PI;
    stage.scene.add(this.meshes.group, this.fx.group, this.marker);

    const first = sim.critters.find((c) => c.id === turns.activeCritter) ?? sim.critters[0];
    if (first)
      this.rig.target = { x: first.pos.x / 65536, y: first.pos.y / 65536, z: first.pos.z / 65536 };
    controls.newTurn();

    if (onRematch) {
      const b = document.createElement("button");
      b.textContent = "Play again";
      b.style.cssText =
        "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:none;font:700 22px system-ui;padding:10px 22px;border:3px solid #3b2a1a;border-radius:14px;background:#ffd23f;color:#3b2a1a;cursor:pointer;box-shadow:0 4px 0 #3b2a1a";
      b.addEventListener("click", onRematch);
      document.body.append(b);
      this.again = b;
    }
  }

  /** Advance the match by `dt` seconds of real time and draw it. */
  frame(dt: number): void {
    this.time += dt;
    const { source, controls } = this;
    const before = source.state.turns;
    const local = source.localTeams;
    const mine = (team: number | null): boolean =>
      team !== null && (local === null || local.has(team));

    // Controls first (so this frame's key presses go out with this frame's ticks), then the sim.
    controls.canFire = before.phase === "control" && mine(before.activeTeam);
    controls.cameraYawDeg = this.rig.yawDeg;
    const mouse = controls.frame(dt);
    const events = source.advance(dt * 1000);
    const state = source.state;
    const v = viewFromMatch(
      state,
      this.teams,
      source.config.startHealth,
      mine(state.turns.activeTeam),
    );
    const active = v.critters.find((c) => c.id === v.activeCritterId);
    if (active) controls.headingDeg = active.headingDeg;
    const aim = controls.aim;

    this.onEvents(events, v);
    if (state.sim.terrain !== this.terrain) {
      this.terrain = state.sim.terrain;
      this.meshes.setTerrain(this.terrain);
    }
    this.meshes.update(4);
    this.syncCritters(v, aim ? yawToDeg(aim.yaw) : null);
    this.syncShots(v);

    this.marker.visible = !!active && v.phase === "control" && !aim;
    if (active)
      this.marker.position.set(
        active.x,
        active.y + CRITTER_HEIGHT + 3.5 + Math.sin(this.time * 4) * 0.4,
        active.z,
      );

    // Camera goal by situation: follow the shot, hold on the blast, aim over the shoulder, else orbit.
    if (!aim) this.rig = dragOrbit(this.rig, mouse.dx, mouse.dy);
    this.rig = zoom(this.rig, mouse.wheel);
    if (this.blast && (this.blast.left -= dt) <= 0) this.blast = null;
    const shot = v.projectiles[0];
    let goal: RigGoal;
    if (shot) goal = { mode: "follow", target: { x: shot.x, y: shot.y, z: shot.z }, dist: 38 };
    else if (this.blast) goal = { mode: "follow", target: this.blast.at, dist: 42 };
    else if (aim && active) {
      const d = aimDirection(aim);
      goal = {
        mode: "aim",
        target: {
          x: active.x + d.x * 22,
          y: active.y + CRITTER_HEIGHT * 0.8 + d.y * 22,
          z: active.z + d.z * 22,
        },
        yawDeg: cameraYawForHeading(yawToDeg(aim.yaw)),
        pitchDeg: -aim.pitchDeg,
        dist: AIM_DIST + 22,
      };
    } else {
      goal = {
        mode: "orbit",
        target: active
          ? { x: active.x, y: active.y + CRITTER_HEIGHT * 0.6, z: active.z }
          : this.rig.target,
        pitchDeg: clamp(this.rig.pitchDeg, ORBIT_LIMITS.minPitch, ORBIT_LIMITS.maxPitch),
        dist: clamp(this.rig.dist, ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist),
      };
    }
    this.rig = stepRig(this.rig, goal, dt);
    const p = rigPosition(this.rig);
    // Never let the camera sink under the ground or the soda.
    p.y = Math.max(p.y, this.groundY(state.sim.terrain, p.x, p.z) + 2.5, v.seaY + 2);
    const cam = this.stage.camera;
    this.fx.update(dt, cam);
    cam.position.set(p.x, p.y, p.z).add(this.fx.shakeOffset);
    cam.lookAt(this.rig.target.x, this.rig.target.y, this.rig.target.z);

    this.env.setSeaY(v.seaY);
    this.env.update(dt, v.wind);
    const hint = !v.myTurn || v.phase === "settling" ? HINT_WATCH : aim ? HINT_AIM : HINT_WALK;
    this.hud.update(v, aim, v.phase === "over" ? "" : hint, controls.weaponName);

    if (!this.ended && v.phase === "over") {
      this.ended = true;
      if (this.again) this.again.style.display = "block";
      window.dispatchEvent(
        new CustomEvent("burrow:matchend", {
          detail: { winnerTeam: v.winnerTeam, tick: state.sim.tick },
        }),
      );
    }
  }

  dispose(): void {
    const { scene } = this.stage;
    scene.remove(this.meshes.group, this.fx.group, this.marker);
    for (const m of this.critters.values()) scene.remove(m);
    for (const m of this.shots.values()) scene.remove(m);
    this.meshes.dispose();
    this.env.dispose();
    this.hud.dispose();
    this.again?.remove();
    this.controls.newTurn();
  }

  /** y of the first air voxel above the ground at a world position (0 outside the map). */
  private groundY(t: VoxelTerrain, x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    if (xi < 0 || zi < 0 || xi >= t.sizeX || zi >= t.sizeZ) return 0;
    return topSolidY(t, xi, zi) + 1;
  }

  private onEvents(events: readonly SimEvent[], v: ViewState): void {
    const kinds = new Set<string>();
    for (const e of events) {
      kinds.add(e.type);
      if (e.type === "explosion" && e.edit.op !== "box") {
        const at = { x: e.edit.x + 0.5, y: e.edit.y + 0.5, z: e.edit.z + 0.5 };
        this.fx.explode(at.x, at.y, at.z, e.edit.r);
        this.blast = { at, left: BLAST_HOLD_S };
      }
      if (e.type === "damage") {
        const c = v.critters.find((x) => x.id === e.critterId);
        if (c) this.fx.damage(c.x, c.y + CRITTER_HEIGHT, c.z, e.amount);
      }
    }
    if (kinds.has("fired")) audio.play("fire");
    if (kinds.has("explosion")) audio.play("explosion");
    if (kinds.has("jumped")) audio.play("jump");
    if (kinds.has("landed")) audio.play("land");
    if (kinds.has("damage")) audio.play("damage");
  }

  private syncCritters(v: ViewState, aimHeadingDeg: number | null): void {
    for (const c of v.critters) {
      let m = this.critters.get(c.id);
      if (!m) {
        const team = this.teams[c.team];
        m = createMolekin3D(c.team, team?.hat ?? defaultHat(c.team), team?.color);
        this.critters.set(c.id, m);
        this.stage.scene.add(m);
      }
      m.visible = c.alive;
      m.position.set(c.x, c.y, c.z);
      const isActive = c.id === v.activeCritterId;
      const heading = isActive && aimHeadingDeg !== null ? aimHeadingDeg : c.headingDeg;
      m.rotation.y = (heading * Math.PI) / 180;
      animateMolekin(m, this.time, isActive);
    }
  }

  private syncShots(v: ViewState): void {
    const seen = new Set<number>();
    for (const p of v.projectiles) {
      seen.add(p.id);
      let m = this.shots.get(p.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.SphereGeometry(p.kind === "grenade" ? 0.8 : 0.9, 12, 8),
          new THREE.MeshStandardMaterial({ color: p.kind === "grenade" ? 0x4aa3df : 0x8b5a2b }),
        );
        m.castShadow = true;
        this.shots.set(p.id, m);
        this.stage.scene.add(m);
      }
      m.position.set(p.x, p.y, p.z);
    }
    for (const [id, m] of this.shots) {
      if (seen.has(id)) continue;
      this.stage.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.shots.delete(id);
    }
  }
}
