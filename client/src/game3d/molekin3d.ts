import * as THREE from "three";
import { teamColor } from "./teamColors";
import { CRITTER_HEIGHT, type HatStyle } from "./viewState";

// Procedural Molekin: a round clay mole with goggles, nose, little feet and a team-coloured hat.
// Built at its own size, then scaled so it stands CRITTER_HEIGHT (6) voxels tall with its feet at y = 0
// and faces +z. Meshes are shared by every critter (one geometry set), so 32 critters stay cheap.

const LOCAL_FEET = -0.95;
const LOCAL_TOP = 1.45;
const SCALE = CRITTER_HEIGHT / (LOCAL_TOP - LOCAL_FEET);

const G = {
  body: new THREE.SphereGeometry(1, 20, 14),
  foot: new THREE.SphereGeometry(0.28, 10, 8),
  eye: new THREE.TorusGeometry(0.2, 0.06, 8, 16),
  lens: new THREE.CircleGeometry(0.17, 14),
  nose: new THREE.SphereGeometry(0.16, 10, 8),
  dome: new THREE.SphereGeometry(0.66, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.8, 0.8, 0.06, 20),
  cone: new THREE.ConeGeometry(0.5, 0.95, 16),
  cylinder: new THREE.CylinderGeometry(0.46, 0.5, 0.7, 16),
  puff: new THREE.SphereGeometry(0.34, 10, 8),
  crown: new THREE.CylinderGeometry(0.52, 0.46, 0.38, 5),
  spike: new THREE.ConeGeometry(0.12, 0.3, 6),
  prop: new THREE.BoxGeometry(1.1, 0.04, 0.16),
  pot: new THREE.CylinderGeometry(0.58, 0.4, 0.5, 16),
  pirate: new THREE.ConeGeometry(0.85, 0.5, 3),
};

const M = {
  fur: new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.95 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0xcfeff7, roughness: 0.15, emissive: 0x1a3a44 }),
  nose: new THREE.MeshStandardMaterial({ color: 0xf4a7b9, roughness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.8 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xf6c945, roughness: 0.35, metalness: 0.4 }),
};

const hatMaterials = new Map<number, THREE.MeshStandardMaterial>();
function hatMat(hex: number): THREE.MeshStandardMaterial {
  let m = hatMaterials.get(hex);
  if (!m)
    hatMaterials.set(hex, (m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6 })));
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

export function buildHat(style: HatStyle, hex: number): THREE.Group {
  const hat = new THREE.Group();
  hat.name = `hat-${style}`;
  const c = hatMat(hex);
  switch (style) {
    case "miner": {
      hat.add(mesh(G.dome, c), mesh(G.brim, c, 0, 0, 0.1));
      hat.add(mesh(G.eye, M.gold, 0, 0.3, 0.62)); // headlamp
      break;
    }
    case "chef": {
      hat.add(mesh(G.cylinder, M.white, 0, 0.3, 0));
      const top = mesh(G.puff, M.white, 0, 0.78, 0);
      top.scale.set(1.5, 1, 1.5);
      hat.add(top, mesh(G.brim, c, 0, 0.0, 0));
      break;
    }
    case "cone": {
      hat.add(mesh(G.cone, c, 0, 0.45, 0), mesh(G.brim, c, 0, 0, 0));
      break;
    }
    case "pirate": {
      const tri = mesh(G.pirate, c, 0, 0.2, 0);
      tri.scale.set(1, 1, 0.9);
      hat.add(tri, mesh(G.brim, M.dark, 0, 0, 0));
      break;
    }
    case "propeller": {
      hat.add(mesh(G.dome, c));
      const blade = mesh(G.prop, M.white, 0, 0.7, 0);
      blade.name = "propeller";
      hat.add(blade);
      break;
    }
    case "crown": {
      hat.add(mesh(G.crown, M.gold, 0, 0.15, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        hat.add(mesh(G.spike, c, Math.sin(a) * 0.46, 0.5, Math.cos(a) * 0.46));
      }
      break;
    }
    case "pot": {
      hat.add(mesh(G.pot, c, 0, 0.2, 0), mesh(G.puff, M.dark, 0, 0.5, 0));
      break;
    }
    case "party": {
      const k = mesh(G.cone, c, 0, 0.5, 0);
      k.scale.set(0.8, 1.2, 0.8);
      hat.add(k, mesh(G.puff, M.white, 0, 1.08, 0));
      break;
    }
  }
  return hat;
}

/** One Molekin, feet at the origin, facing +z, 6 voxels tall. */
export function createMolekin3D(team: number, style: HatStyle): THREE.Group {
  const root = new THREE.Group();
  root.name = `molekin-team-${team}`;
  const model = new THREE.Group();
  model.name = "model";
  model.scale.setScalar(SCALE);
  model.position.y = -LOCAL_FEET * SCALE;
  root.add(model);

  const body = mesh(G.body, M.fur);
  body.scale.set(1, 0.88, 0.95);
  model.add(body);
  for (const sx of [-0.4, 0.4]) {
    model.add(mesh(G.foot, M.fur, sx, -0.88, 0.25));
    const ring = mesh(G.eye, M.frame, sx * 0.62, 0.22, 0.92);
    const lens = mesh(G.lens, M.lens, sx * 0.62, 0.22, 0.93);
    lens.castShadow = false;
    model.add(ring, lens);
  }
  model.add(mesh(G.nose, M.nose, 0, 0.0, 1.0));

  const hat = buildHat(style, teamColor(team));
  hat.position.y = 0.72;
  hat.name = "hat";
  model.add(hat);
  return root;
}

/** Idle wobble and propeller spin; call every frame with elapsed seconds. */
export function animateMolekin(root: THREE.Group, t: number, active: boolean): void {
  const model = root.getObjectByName("model");
  if (model) {
    const s = active ? 1 + Math.sin(t * 6) * 0.015 : 1;
    model.scale.setScalar(SCALE * s);
  }
  const prop = root.getObjectByName("propeller");
  if (prop) prop.rotation.y = t * 14;
}

export const MOLEKIN_SCALE = SCALE;
