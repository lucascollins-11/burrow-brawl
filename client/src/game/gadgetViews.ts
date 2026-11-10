import type { SimState } from "@burrow-brawl/shared";
import { fromFixed } from "@burrow-brawl/shared";
import * as THREE from "three";

const CRATE_HALF = 4;
const BOULDER_RADIUS = 20;

/** Placeholder meshes for ropes, boulders and supply crates (mask space +y down, world +y up). */
export class GadgetViews {
  readonly group = new THREE.Group();
  private readonly ropes = new Map<number, THREE.Line>();
  private readonly boulders = new Map<number, THREE.Mesh>();
  private readonly crates = new Map<number, THREE.Mesh>();
  private readonly ropeMaterial = new THREE.LineBasicMaterial({ color: 0x3b2a1a });
  private readonly boulderGeometry = new THREE.SphereGeometry(BOULDER_RADIUS, 16, 12);
  private readonly boulderMaterial = new THREE.MeshStandardMaterial({ color: 0x7a6a5a });
  private readonly crateGeometry = new THREE.BoxGeometry(
    CRATE_HALF * 2,
    CRATE_HALF * 2,
    CRATE_HALF * 2,
  );
  private readonly healthMaterial = new THREE.MeshStandardMaterial({ color: 0xe85d4a });
  private readonly weaponMaterial = new THREE.MeshStandardMaterial({ color: 0xf2b544 });

  sync(sim: SimState, time: number): void {
    // Ropes: a line from the critter's body centre to the hook or anchor.
    const liveRopes = new Set<number>();
    for (const r of sim.ropes) {
      const c = sim.critters.find((x) => x.id === r.critterId);
      if (!c) continue;
      liveRopes.add(r.critterId);
      let line = this.ropes.get(r.critterId);
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry(), this.ropeMaterial);
        this.ropes.set(r.critterId, line);
        this.group.add(line);
      }
      line.geometry.setFromPoints([
        new THREE.Vector3(fromFixed(c.x), -fromFixed(c.y) + 10, 15),
        new THREE.Vector3(fromFixed(r.x), -fromFixed(r.y), 15),
      ]);
    }
    prune(this.ropes, liveRopes, this.group);

    const liveBoulders = new Set<number>();
    for (const b of sim.boulders) {
      liveBoulders.add(b.id);
      let m = this.boulders.get(b.id);
      if (!m) {
        m = new THREE.Mesh(this.boulderGeometry, this.boulderMaterial);
        this.boulders.set(b.id, m);
        this.group.add(m);
      }
      m.position.set(fromFixed(b.x), -fromFixed(b.y), 16);
      m.rotation.z = -fromFixed(b.x) * 0.05 * b.dir; // visual roll only
    }
    prune(this.boulders, liveBoulders, this.group);

    const liveCrates = new Set<number>();
    for (const cr of sim.crates) {
      liveCrates.add(cr.id);
      let m = this.crates.get(cr.id);
      if (!m) {
        m = new THREE.Mesh(
          this.crateGeometry,
          cr.kind === "health" ? this.healthMaterial : this.weaponMaterial,
        );
        this.crates.set(cr.id, m);
        this.group.add(m);
      }
      const bob = cr.grounded ? Math.sin(time * 3 + cr.id) * 0.8 : 0;
      m.position.set(cr.x, -fromFixed(cr.y) + bob, 14);
      m.rotation.y = cr.grounded ? 0 : Math.sin(time * 2 + cr.id) * 0.4;
    }
    prune(this.crates, liveCrates, this.group);
  }

  dispose(): void {
    this.crateGeometry.dispose();
    this.boulderGeometry.dispose();
    for (const l of this.ropes.values()) l.geometry.dispose();
  }
}

function prune<T extends THREE.Object3D>(
  map: Map<number, T>,
  live: Set<number>,
  group: THREE.Group,
): void {
  for (const [id, o] of map) {
    if (!live.has(id)) {
      group.remove(o);
      map.delete(id);
    }
  }
}
