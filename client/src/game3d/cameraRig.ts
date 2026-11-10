// Camera maths with no three.js in it, so it is easy to test. Y is up; yaw 0 looks along -z
// (so the camera sits at +z of its target), yaw increases counter-clockwise seen from above.

export type CameraMode = "orbit" | "aim" | "follow";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ORBIT_LIMITS = { minPitch: 8, maxPitch: 85, minDist: 12, maxDist: 160 } as const;
export const AIM_DIST = 14;

const RAD = Math.PI / 180;
export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));
/** Wrap degrees into [0, 360). */
export const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;

/** Unit vector from the target toward the camera for a given yaw and pitch (degrees). */
export function offsetDir(yawDeg: number, pitchDeg: number): Vec3 {
  const cp = Math.cos(pitchDeg * RAD);
  return {
    x: cp * Math.sin(yawDeg * RAD),
    y: Math.sin(pitchDeg * RAD),
    z: cp * Math.cos(yawDeg * RAD),
  };
}

/** Ground-plane unit vectors that point away from the camera (forward) and to its right. */
export function groundAxes(yawDeg: number): { forward: Vec3; right: Vec3 } {
  const s = Math.sin(yawDeg * RAD);
  const c = Math.cos(yawDeg * RAD);
  return { forward: { x: -s, y: 0, z: -c }, right: { x: c, y: 0, z: -s } };
}

/**
 * Walk direction (unit, on the ground plane) for WASD relative to the camera, or null when idle.
 * `forward` and `right` are -1, 0 or 1 (W/S and D/A).
 */
export function moveRelativeToCamera(yawDeg: number, forward: number, right: number): Vec3 | null {
  if (forward === 0 && right === 0) return null;
  const { forward: f, right: r } = groundAxes(yawDeg);
  const x = f.x * forward + r.x * right;
  const z = f.z * forward + r.z * right;
  const len = Math.hypot(x, z);
  return { x: x / len, y: 0, z: z / len };
}

/** Heading in degrees (0 = +z, 90 = +x) of a ground-plane direction. */
export const headingOf = (dir: Vec3): number => wrapDeg(Math.atan2(dir.x, dir.z) / RAD);

/** The sim's yaw circle: 1024 steps (0 = +z, 256 = +x). */
export const YAW_STEPS = 1024;
export const yawToDeg = (yaw: number): number => (yaw * 360) / YAW_STEPS;
export const degToYaw = (deg: number): number =>
  ((Math.round((wrapDeg(deg) * YAW_STEPS) / 360) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;

export interface AimState {
  /** Heading of the shot on the ground in sim units 0..1023 (0 = +z, 256 = +x), as sent in fire commands. */
  yaw: number;
  /** Elevation above the horizon, whole degrees. */
  /** Elevation above the horizon, whole degrees (-89..89 on the wire). */
  pitchDeg: number;
  /** 0 to 100. */
  power: number;
  charging: boolean;
}

export const AIM_LIMITS = { minPitch: -20, maxPitch: 80 } as const;
export const CHARGE_PER_SECOND = 70;

export const newAim = (headingDeg: number): AimState => ({
  yaw: degToYaw(headingDeg),
  pitchDeg: 30,
  power: 0,
  charging: false,
});

/** Turn the crosshair by a mouse movement (pixels). Whole degrees keep the command integer. */
export function nudgeAim(a: AimState, dxPx: number, dyPx: number, sensitivity = 0.25): AimState {
  return {
    ...a,
    yaw: degToYaw(yawToDeg(a.yaw) - dxPx * sensitivity),
    pitchDeg: Math.round(
      clamp(a.pitchDeg - dyPx * sensitivity, AIM_LIMITS.minPitch, AIM_LIMITS.maxPitch),
    ),
  };
}

/** Charge up while the fire key is held; the power rises and stops at 100. */
export function chargeAim(a: AimState, dt: number): AimState {
  return a.charging ? { ...a, power: Math.min(100, a.power + CHARGE_PER_SECOND * dt) } : a;
}

/** Unit direction of the shot in world space (display only; the sim uses its own integer tables). */
export function aimDirection(a: AimState): Vec3 {
  const cp = Math.cos(a.pitchDeg * RAD);
  const yaw = yawToDeg(a.yaw) * RAD;
  return { x: cp * Math.sin(yaw), y: Math.sin(a.pitchDeg * RAD), z: cp * Math.cos(yaw) };
}

/** Camera yaw that looks along a shot heading (the camera sits behind the shooter). */
export const cameraYawForHeading = (headingDeg: number): number => wrapDeg(headingDeg + 180);

export interface RigState {
  mode: CameraMode;
  yawDeg: number;
  pitchDeg: number;
  dist: number;
  target: Vec3;
}

export const initialRig = (): RigState => ({
  mode: "orbit",
  yawDeg: 30,
  pitchDeg: 35,
  dist: 60,
  target: { x: 128, y: 30, z: 128 },
});

/** Exponential smoothing factor for a frame: 1 - e^(-rate*dt). Frame-rate independent. */
export const smoothing = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Shortest signed angle from a to b in degrees. */
export const angleDelta = (from: number, to: number): number =>
  ((((to - from) % 360) + 540) % 360) - 180;

/** Orbit by a mouse drag (pixels). Dragging right swings the camera round to the left, like grabbing the world. */
export function dragOrbit(r: RigState, dxPx: number, dyPx: number, sensitivity = 0.3): RigState {
  return {
    ...r,
    yawDeg: wrapDeg(r.yawDeg - dxPx * sensitivity),
    pitchDeg: clamp(r.pitchDeg + dyPx * sensitivity, ORBIT_LIMITS.minPitch, ORBIT_LIMITS.maxPitch),
  };
}

/** Wheel zoom: multiplicative so each notch feels the same at any distance. */
export function zoom(r: RigState, wheelDelta: number): RigState {
  return {
    ...r,
    dist: clamp(r.dist * Math.exp(wheelDelta * 0.001), ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist),
  };
}

/** Camera position for a rig. */
export function rigPosition(r: RigState): Vec3 {
  const d = offsetDir(r.yawDeg, r.pitchDeg);
  return {
    x: r.target.x + d.x * r.dist,
    y: r.target.y + d.y * r.dist,
    z: r.target.z + d.z * r.dist,
  };
}

/** Where the camera wants to be this frame, and how fast it chases that. */
export interface RigGoal {
  mode: CameraMode;
  target: Vec3;
  /** Only used by "aim" and "follow": the camera yaw/pitch/dist to move toward. */
  yawDeg?: number;
  pitchDeg?: number;
  dist?: number;
}

/** Move the rig toward its goal. Orbit mode keeps the player's yaw/pitch/zoom and only follows the target. */
export function stepRig(r: RigState, goal: RigGoal, dt: number): RigState {
  const fast = goal.mode === "aim" ? 14 : goal.mode === "follow" ? 5 : 6;
  const k = smoothing(fast, dt);
  const target = {
    x: r.target.x + (goal.target.x - r.target.x) * k,
    y: r.target.y + (goal.target.y - r.target.y) * k,
    z: r.target.z + (goal.target.z - r.target.z) * k,
  };
  let { yawDeg, pitchDeg, dist } = r;
  if (goal.yawDeg !== undefined) yawDeg = wrapDeg(yawDeg + angleDelta(yawDeg, goal.yawDeg) * k);
  if (goal.pitchDeg !== undefined) pitchDeg += (goal.pitchDeg - pitchDeg) * k;
  if (goal.dist !== undefined) dist += (goal.dist - dist) * k;
  return { mode: goal.mode, yawDeg, pitchDeg, dist, target };
}
