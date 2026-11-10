import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CRITTER_HEIGHT_CELLS, CRITTER_WIDTH_CELLS, TEAM_COLORS, createMolekin } from "./molekin";

describe("TEAM_COLORS", () => {
  it("has four teams with unique ids and colours", () => {
    expect(TEAM_COLORS).toHaveLength(8);
    expect(new Set(TEAM_COLORS.map((t) => t.id)).size).toBe(8);
    expect(new Set(TEAM_COLORS.map((t) => t.hex)).size).toBe(8);
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

  it("is CRITTER_HEIGHT_CELLS tall with its feet at the origin", () => {
    const group = createMolekin(0);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);

    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(CRITTER_HEIGHT_CELLS, 5);
  });

  it("is CRITTER_WIDTH_CELLS wide, centred on x", () => {
    const group = createMolekin(0);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);

    expect(box.max.x - box.min.x).toBeCloseTo(CRITTER_WIDTH_CELLS, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
  });

  it.each([0, 1, 2, 3])("paints the hat in the colour of team slot %i", (slot) => {
    const group = createMolekin(slot);
    const hat = group.getObjectByName("hat") as THREE.Mesh;
    const material = hat.material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(TEAM_COLORS[slot]?.hex);
  });

  it.each([-1, 8, 1.5])("rejects invalid team slot %s", (slot) => {
    expect(() => createMolekin(slot)).toThrow(RangeError);
  });
});
