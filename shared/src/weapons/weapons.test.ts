import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { loadWeapons } from "./load";

const WEAPONS_DIR = fileURLToPath(new URL("../../weapons/", import.meta.url));
const SCHEMA_FILE = "weapon.schema.json";

const schema = JSON.parse(readFileSync(`${WEAPONS_DIR}${SCHEMA_FILE}`, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

const weaponFiles = readdirSync(WEAPONS_DIR)
  .filter((f) => f.endsWith(".json") && f !== SCHEMA_FILE)
  .sort();

function readWeapon(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${WEAPONS_DIR}${file}`, "utf8")) as Record<string, unknown>;
}

describe("weapon data files", () => {
  it("found the 27 weapon files (12 starting weapons, waves 1 and 2, sub-munitions)", () => {
    expect(weaponFiles).toHaveLength(27);
  });

  it.each(weaponFiles)("%s validates against weapon.schema.json", (file) => {
    expect(validate(readWeapon(file)), JSON.stringify(validate.errors)).toBe(true);
  });

  it("has unique ids", () => {
    const ids = weaponFiles.map((file) => readWeapon(file)["id"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(weaponFiles)("%s has an id equal to its filename", (file) => {
    expect(readWeapon(file)["id"]).toBe(basename(file, ".json"));
  });

  it("loadWeapons() has one entry per file, keyed by id", () => {
    const registry = loadWeapons();
    const ids = weaponFiles.map((file) => basename(file, ".json")).sort();
    expect(Object.keys(registry).sort()).toEqual(ids);
    for (const id of ids) {
      expect(registry[id as keyof typeof registry].id).toBe(id);
    }
  });
});
