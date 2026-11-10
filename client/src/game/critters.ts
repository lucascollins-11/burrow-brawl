import type { Critter } from "@burrow-brawl/shared";
import { fromFixed } from "@burrow-brawl/shared";
import * as THREE from "three";
import { createMolekin } from "../art/molekin";

/** One Molekin model per critter, positioned from sim state (mask space is +y down, world is +y up). */
export class CritterViews {
  readonly group = new THREE.Group();
  /** One pivot per critter; the Molekin inside keeps its own scale and feet-at-origin offset. */
  private readonly models = new Map<number, THREE.Group>();
  private readonly marker: THREE.Mesh;
  /** Optional hat colour per sim team index (online: from the lobby). Defaults to TEAM_COLORS. */
  hats: readonly number[] = [];

  constructor() {
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(5, 10, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    );
    this.marker.rotation.x = Math.PI; // point down at the active critter
    this.group.add(this.marker);
  }

  sync(critters: readonly Critter[], activeId: number | null, time: number): void {
    this.marker.visible = false;
    for (const c of critters) {
      let m = this.models.get(c.id);
      if (!m) {
        m = new THREE.Group();
        m.add(createMolekin(c.team, this.hats[c.team]));
        this.models.set(c.id, m);
        this.group.add(m);
      }
      m.visible = c.status !== "drowned";
      const x = fromFixed(c.x);
      const feetY = -fromFixed(c.y);
      m.position.set(x, feetY, 14);
      // The model faces +z; turn it to face along the play plane.
      m.rotation.y = c.facing === 1 ? Math.PI / 2 : -Math.PI / 2;
      m.rotation.z = c.status === "dead" ? Math.PI / 2 : 0;
      if (c.id === activeId && c.status === "alive") {
        this.marker.visible = true;
        this.marker.position.set(x, feetY + 32 + Math.sin(time * 6) * 3, 16);
      }
    }
  }
}
