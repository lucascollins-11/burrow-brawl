import * as THREE from "three";

/**
 * Placeholder Molekin critter, built from Three.js primitives.
 * Real models will replace this later; keep the export names stable.
 */

export interface TeamColor {
  readonly id: string;
  readonly name: string;
  readonly hex: number;
}

/** Hat colours for the four team slots. Index is the team slot (0 to 3). */
export const TEAM_COLORS = [
  { id: "tomato", name: "Tomato", hex: 0xe85d4a },
  { id: "sky", name: "Sky", hex: 0x4aa3df },
  { id: "mustard", name: "Mustard", hex: 0xf2b544 },
  { id: "mint", name: "Mint", hex: 0x5cc49b },
] as const satisfies readonly TeamColor[];

/**
 * The Molekin is built at its own size (feet at y = -0.85, hat top at y = 1.32), then scaled so it
 * is CRITTER_HEIGHT_CELLS tall with its feet at the origin. Keep this value in sync with
 * CRITTER_HEIGHT in shared/src/sim/constants.ts.
 */
export const CRITTER_HEIGHT_CELLS = 20;
const LOCAL_FEET_Y = -0.85;
const LOCAL_TOP_Y = 1.32;

const FUR_COLOR = 0x8b5e3c;
const FRAME_COLOR = 0x2b2b2b;
const LENS_COLOR = 0x9fd8e8;
const NOSE_COLOR = 0xf4a7b9;

/**
 * Builds one Molekin with its feet at the origin, CRITTER_HEIGHT_CELLS tall, facing +z.
 * Throws a RangeError if teamIndex is not a valid team slot.
 */
export function createMolekin(teamIndex: number): THREE.Group {
  const team = TEAM_COLORS[teamIndex];
  if (team === undefined) {
    throw new RangeError(
      `teamIndex must be an integer from 0 to ${TEAM_COLORS.length - 1}, got ${teamIndex}`,
    );
  }

  const group = new THREE.Group();
  group.name = `molekin-${team.id}`;
  const scale = CRITTER_HEIGHT_CELLS / (LOCAL_TOP_Y - LOCAL_FEET_Y);
  group.scale.setScalar(scale);
  group.position.y = -LOCAL_FEET_Y * scale;

  const furMaterial = new THREE.MeshStandardMaterial({ color: FUR_COLOR, roughness: 0.9 });
  const hatMaterial = new THREE.MeshStandardMaterial({ color: team.hex, roughness: 0.6 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.5 });
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: LENS_COLOR,
    roughness: 0.2,
    transparent: true,
    opacity: 0.7,
  });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: NOSE_COLOR, roughness: 0.7 });

  // Round felt body, squashed a little vertically.
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), furMaterial);
  body.name = "body";
  body.scale.set(1, 0.85, 1);
  group.add(body);

  // Hard hat: a dome sitting on top of the body, with a brim.
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    hatMaterial,
  );
  hat.name = "hat";
  hat.position.y = 0.7;
  group.add(hat);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 24), hatMaterial);
  brim.name = "hat-brim";
  brim.position.y = 0.7;
  group.add(brim);

  // Goggles: one frame and lens per eye, on the front of the body.
  for (const side of [-1, 1] as const) {
    const x = side * 0.36;
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), frameMaterial);
    frame.name = side < 0 ? "goggle-frame-left" : "goggle-frame-right";
    frame.position.set(x, 0.2, 0.86);
    group.add(frame);

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), lensMaterial);
    lens.name = side < 0 ? "goggle-lens-left" : "goggle-lens-right";
    lens.position.set(x, 0.2, 0.84);
    group.add(lens);
  }

  // Nose.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), noseMaterial);
  nose.name = "nose";
  nose.position.set(0, 0, 1);
  group.add(nose);

  return group;
}
