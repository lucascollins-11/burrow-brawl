import { describe, expect, it } from "vitest";
import {
  aimDirection,
  chargeAim,
  dragOrbit,
  groundAxes,
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
} from "./cameraRig";
import { compass, summarizeTeams, turnBanner, turnOrder, windStreamer } from "./hudModel";
import type { ViewState } from "./viewState";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("camera-relative movement", () => {
  it("W walks away from the camera, whatever the yaw", () => {
    for (const yaw of [0, 33, 90, 180, 271]) {
      const cam = rigPosition({ ...initialRig(), yawDeg: yaw, target: { x: 0, y: 0, z: 0 } });
      const dir = moveRelativeToCamera(yaw, 1, 0)!;
      // Walking forward moves the target farther from the camera on the ground plane.
      const before = Math.hypot(cam.x, cam.z);
      const after = Math.hypot(cam.x - dir.x, cam.z - dir.z);
      expect(after).toBeGreaterThan(before);
      close(Math.hypot(dir.x, dir.z), 1);
    }
  });

  it("D goes to the right of the view and diagonals stay unit length", () => {
    const { forward, right } = groundAxes(0);
    close(forward.z, -1);
    close(right.x, 1);
    const d = moveRelativeToCamera(0, 1, 1)!;
    close(Math.hypot(d.x, d.z), 1);
    expect(moveRelativeToCamera(0, 0, 0)).toBeNull();
  });

  it("headings follow the 0 = +z, 90 = +x convention", () => {
    close(headingOf({ x: 0, y: 0, z: 1 }), 0);
    close(headingOf({ x: 1, y: 0, z: 0 }), 90);
    close(headingOf({ x: 0, y: 0, z: -1 }), 180);
    close(headingOf({ x: -1, y: 0, z: 0 }), 270);
  });
});

describe("orbit rig", () => {
  it("clamps pitch and zoom", () => {
    let r = initialRig();
    r = dragOrbit(r, 0, 10_000);
    expect(r.pitchDeg).toBe(ORBIT_LIMITS.maxPitch);
    r = dragOrbit(r, 0, -10_000);
    expect(r.pitchDeg).toBe(ORBIT_LIMITS.minPitch);
    expect(zoom(r, 1e6).dist).toBe(ORBIT_LIMITS.maxDist);
    expect(zoom(r, -1e6).dist).toBe(ORBIT_LIMITS.minDist);
  });

  it("keeps its distance from the target", () => {
    const r = dragOrbit(initialRig(), 120, -40);
    const p = rigPosition(r);
    close(Math.hypot(p.x - r.target.x, p.y - r.target.y, p.z - r.target.z), r.dist, 1e-6);
  });

  it("chases a goal smoothly and frame-rate independently", () => {
    const goal = { mode: "follow" as const, target: { x: 10, y: 5, z: -20 }, dist: 30 };
    let a = initialRig();
    for (let i = 0; i < 60; i++) a = stepRig(a, goal, 1 / 60);
    let b = initialRig();
    for (let i = 0; i < 30; i++) b = stepRig(b, goal, 1 / 30);
    close(a.target.x, b.target.x, 1e-6);
    close(a.dist, b.dist, 1e-6);
    expect(a.mode).toBe("follow");
  });
});

describe("aim", () => {
  it("uses the sim's 1024-step yaw and whole-degree pitch", () => {
    let a = newAim(90); // heading +x is yaw 0 on the wire
    expect(a.yaw).toBe(0);
    expect(newAim(0).yaw).toBe(256); // heading +z is yaw 256
    expect(yawToDeg(256)).toBeCloseTo(0);
    a = nudgeAim(a, 4, -8); // right a little, up a little
    expect(Number.isInteger(a.yaw) && Number.isInteger(a.pitchDeg)).toBe(true);
    expect(a.yaw).toBeGreaterThanOrEqual(0);
    expect(a.yaw).toBeLessThan(1024);
    expect(yawToDeg(1024 - 1)).toBeLessThan(360);
    const huge = nudgeAim(a, 0, -1e6);
    expect(huge.pitchDeg).toBe(80);
  });

  it("aims where it says and charges to 100 only while held", () => {
    const d = aimDirection({ ...newAim(0), pitchDeg: 0 });
    close(d.z, 1);
    const idle = chargeAim(newAim(0), 1);
    expect(idle.power).toBe(0);
    const held = chargeAim({ ...newAim(0), charging: true }, 10);
    expect(held.power).toBe(100);
  });
});

const view = (over: Partial<ViewState> = {}): ViewState => ({
  teams: [0, 1, 2].map((i) => ({ index: i, name: `T${i}`, hat: "miner" as const })),
  critters: [
    {
      id: 1,
      team: 0,
      name: "a",
      x: 0,
      y: 0,
      z: 0,
      headingDeg: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
    },
    { id: 2, team: 1, name: "b", x: 0, y: 0, z: 0, headingDeg: 0, hp: 50, maxHp: 100, alive: true },
    { id: 3, team: 1, name: "c", x: 0, y: 0, z: 0, headingDeg: 0, hp: 0, maxHp: 100, alive: false },
    { id: 4, team: 2, name: "d", x: 0, y: 0, z: 0, headingDeg: 0, hp: 0, maxHp: 100, alive: false },
  ],
  projectiles: [],
  activeCritterId: 2,
  activeTeam: 1,
  phase: "control",
  round: 1,
  timeLeft: 30,
  wind: { x: 0, z: 0 },
  seaY: 4,
  winnerTeam: null,
  ...over,
});

describe("hud model", () => {
  it("summarizes teams and drops eliminated ones from the turn order", () => {
    const s = summarizeTeams(view());
    expect(s[1]).toMatchObject({ alive: 1, total: 2, hp: 50, maxHp: 200, active: true });
    expect(s[2]!.out).toBe(true);
    expect(turnOrder(view())).toEqual([1, 0]);
    expect(turnOrder(view({ activeTeam: null }))).toEqual([0, 1]);
  });

  it("describes wind, compass points and the banner", () => {
    expect(windStreamer({ x: 0, z: 0 }).strength).toBe(0);
    const w = windStreamer({ x: 100, z: 0 });
    close(w.headingDeg, 90);
    expect(w.strength).toBe(1);
    expect(compass(90)).toBe("E");
    expect(turnBanner(view())).toBe("Round 1 · T1's turn: b");
    expect(turnBanner(view({ phase: "over", winnerTeam: 0 }))).toBe("T0 wins!");
  });
});
