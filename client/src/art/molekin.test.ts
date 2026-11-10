import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TEAM_COLORS, createMolekin } from "./molekin";

describe("TEAM_COLORS", () => {
  it("has four teams with unique ids and colours", () => {
    expect(TEAM_COLORS).toHaveLength(4);
    expect(new Set(TEAM_COLORS.map((t) => t.id)).size).toBe(4);
    expect(new Set(TEAM_COLORS.map((t) => t.hex)).size).toBe(4);
  });
});

describe("createMolekin", () => {
  it("builds a named group with body, hat and goggles", () => {
    const group = createMolekin(0);

    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.name).toBe("molekin-tomato");
    expect(group.getObjectByName("body")).toBeInstanceOf(THREE.Mesh);
    expect(group.getObjectByName("hat")).toBeInstanceOf(THREE.Mesh);
    expect(group.getObjectByName("goggle-lens-left")).toBeInstanceOf(THREE.Mesh);
    expect(group.getObjectByName("goggle-lens-right")).toBeInstanceOf(THREE.Mesh);
  });

  it.each([0, 1, 2, 3])("paints the hat in the colour of team slot %i", (slot) => {
    const group = createMolekin(slot);
    const hat = group.getObjectByName("hat") as THREE.Mesh;
    const material = hat.material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(TEAM_COLORS[slot]?.hex);
  });

  it.each([-1, 4, 1.5])("rejects invalid team slot %s", (slot) => {
    expect(() => createMolekin(slot)).toThrow(RangeError);
  });
});
