import type { Mine, Projectile, Strike } from "@burrow-brawl/shared";
import { fromFixed, loadWeapons, TICK_RATE } from "@burrow-brawl/shared";
import * as THREE from "three";

/**
 * Placeholder meshes: acorn = brown sphere, fizz grenade = pink, strike bomb = honey yellow,
 * jelly mine = green dome (turns red once armed), pending strike = a ring on the target.
 */
export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly mineMeshes = new Map<number, THREE.Mesh>();
  private readonly strikeMeshes = new Map<number, THREE.Mesh>();
  private readonly geometry = new THREE.SphereGeometry(4, 12, 8);
  private readonly dome = new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly ring = new THREE.RingGeometry(14, 18, 24);
  private readonly mats = {
    acorn: new THREE.MeshStandardMaterial({ color: 0x8b5a2b }),
    grenade: new THREE.MeshStandardMaterial({ color: 0xff6fa5 }),
    bomb: new THREE.MeshStandardMaterial({ color: 0xf2b134 }),
    mine: new THREE.MeshStandardMaterial({ color: 0x6fd08c }),
    armed: new THREE.MeshStandardMaterial({ color: 0xe0443e }),
    ringMat: new THREE.MeshBasicMaterial({ color: 0xf2b134, side: THREE.DoubleSide }),
  };
  private readonly armTicks = Math.round(
    Number(loadWeapons()["jelly-mine"].params.armSeconds ?? 2) * TICK_RATE,
  );

  sync(
    projectiles: readonly Projectile[],
    mines: readonly Mine[] = [],
    strikes: readonly Strike[] = [],
  ): void {
    const mat = (p: Projectile): THREE.Material =>
      p.weaponId === "acorn-mortar"
        ? this.mats.acorn
        : p.weaponId === "beehive-strike"
          ? this.mats.bomb
          : this.mats.grenade;
    this.reconcile(this.meshes, projectiles, this.geometry, mat, (m, p) =>
      m.position.set(fromFixed(p.x), -fromFixed(p.y), 14),
    );
    this.reconcile(
      this.mineMeshes,
      mines,
      this.dome,
      (m) => (m.age >= this.armTicks ? this.mats.armed : this.mats.mine),
      (m, mine) => m.position.set(mine.x, -mine.y, 14),
    );
    this.reconcile(
      this.strikeMeshes,
      strikes,
      this.ring,
      () => this.mats.ringMat,
      (m, s) => m.position.set(s.x, -s.y, 12),
    );
  }

  private reconcile<T extends { readonly id: number }>(
    meshes: Map<number, THREE.Mesh>,
    items: readonly T[],
    geometry: THREE.BufferGeometry,
    material: (item: T) => THREE.Material,
    place: (mesh: THREE.Mesh, item: T) => void,
  ): void {
    const live = new Set<number>();
    for (const it of items) {
      live.add(it.id);
      let m = meshes.get(it.id);
      if (!m) {
        m = new THREE.Mesh(geometry, material(it));
        meshes.set(it.id, m);
        this.group.add(m);
      }
      m.material = material(it);
      place(m, it);
    }
    for (const [id, m] of meshes) {
      if (!live.has(id)) {
        this.group.remove(m);
        meshes.delete(id);
      }
    }
  }
}
