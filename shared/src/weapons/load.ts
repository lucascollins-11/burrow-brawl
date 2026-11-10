import acornMortar from "../../weapons/acorn-mortar.json";
import beehiveStrike from "../../weapons/beehive-strike.json";
import boulderOfDoom from "../../weapons/boulder-of-doom.json";
import drillHat from "../../weapons/drill-hat.json";
import fizzGrenade from "../../weapons/fizz-grenade.json";
import jellyMine from "../../weapons/jelly-mine.json";
import pepperShotgun from "../../weapons/pepper-shotgun.json";
import ropeClaw from "../../weapons/rope-claw.json";
import rootPunch from "../../weapons/root-punch.json";
import skipTurn from "../../weapons/skip-turn.json";
import springBoots from "../../weapons/spring-boots.json";
import teleportBurrow from "../../weapons/teleport-burrow.json";
import type { WeaponData } from "./types";

/** Ids of the starting arsenal. The keys of the registry are exactly these. */
export type WeaponId =
  | "acorn-mortar"
  | "fizz-grenade"
  | "pepper-shotgun"
  | "root-punch"
  | "spring-boots"
  | "rope-claw"
  | "drill-hat"
  | "beehive-strike"
  | "jelly-mine"
  | "boulder-of-doom"
  | "teleport-burrow"
  | "skip-turn";

export type WeaponRegistry = Readonly<Record<WeaponId, WeaponData>>;

/**
 * Converts a raw JSON import into WeaponData. The "$schema" key is editor
 * metadata, not weapon data, so it is removed here.
 */
function toWeaponData(json: Record<string, unknown>): WeaponData {
  const data: Record<string, unknown> = { ...json };
  delete data["$schema"];
  return data as unknown as WeaponData;
}

const registry: WeaponRegistry = Object.freeze({
  "acorn-mortar": toWeaponData(acornMortar),
  "fizz-grenade": toWeaponData(fizzGrenade),
  "pepper-shotgun": toWeaponData(pepperShotgun),
  "root-punch": toWeaponData(rootPunch),
  "spring-boots": toWeaponData(springBoots),
  "rope-claw": toWeaponData(ropeClaw),
  "drill-hat": toWeaponData(drillHat),
  "beehive-strike": toWeaponData(beehiveStrike),
  "jelly-mine": toWeaponData(jellyMine),
  "boulder-of-doom": toWeaponData(boulderOfDoom),
  "teleport-burrow": toWeaponData(teleportBurrow),
  "skip-turn": toWeaponData(skipTurn),
});

/** Returns the weapon registry, keyed by weapon id. The same frozen object every time. */
export function loadWeapons(): WeaponRegistry {
  return registry;
}
