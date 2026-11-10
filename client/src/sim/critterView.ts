import type { Critter } from "@burrow-brawl/shared";
import { CRITTER_HEIGHT, fromFixed } from "@burrow-brawl/shared";
import * as THREE from "three";

const TEAM_COLORS = [0x5ab0e8, 0xf0c04a, 0x7bd88f, 0xd98cd9];

/** Placeholder capsule per critter until the Molekin model lands. Mask space is +y down, world is +y up. */
export class CritterViews {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();

  sync(critters: readonly Critter[], activeId: number): void {
    for (const c of critters) {
      let m = this.meshes.get(c.id);
      if (!m) {
        const r = 5;
        m = new THREE.Mesh(
          new THREE.CapsuleGeometry(r, CRITTER_HEIGHT - 2 * r, 4, 12),
          new THREE.MeshStandardMaterial({
            color: TEAM_COLORS[c.team % TEAM_COLORS.length] ?? 0xffffff,
          }),
        );
        this.meshes.set(c.id, m);
        this.group.add(m);
      }
      const mat = m.material as THREE.MeshStandardMaterial;
      m.visible = c.status !== "drowned";
      mat.emissive.setHex(c.id === activeId && c.status === "alive" ? 0x444444 : 0x000000);
      if (c.status === "dead") mat.color.setHex(0x888888);
      m.position.set(fromFixed(c.x), -fromFixed(c.y) + CRITTER_HEIGHT / 2, 14);
      m.rotation.z = c.status === "dead" ? Math.PI / 2 : 0;
    }
  }
}
