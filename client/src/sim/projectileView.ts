import type { Projectile } from "@burrow-brawl/shared";
import { fromFixed } from "@burrow-brawl/shared";
import * as THREE from "three";

/** Placeholder meshes for projectiles in flight (acorn = brown sphere, fizz grenade = pink sphere). */
export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly geometry = new THREE.SphereGeometry(4, 12, 8);
  private readonly acorn = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  private readonly grenade = new THREE.MeshStandardMaterial({ color: 0xff6fa5 });

  sync(projectiles: readonly Projectile[]): void {
    const live = new Set<number>();
    for (const p of projectiles) {
      live.add(p.id);
      let m = this.meshes.get(p.id);
      if (!m) {
        m = new THREE.Mesh(
          this.geometry,
          p.weaponId === "acorn-mortar" ? this.acorn : this.grenade,
        );
        this.meshes.set(p.id, m);
        this.group.add(m);
      }
      m.position.set(fromFixed(p.x), -fromFixed(p.y), 14);
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m);
        this.meshes.delete(id);
      }
    }
  }
}
