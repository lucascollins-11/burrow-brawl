import acornMortar from "../../weapons/acorn-mortar.json";
import beehiveBomb from "../../weapons/beehive-bomb.json";
import beehiveStrike from "../../weapons/beehive-strike.json";
import boulderOfDoom from "../../weapons/boulder-of-doom.json";
import bubbleShield from "../../weapons/bubble-shield.json";
import buildBlock from "../../weapons/build-block.json";
import cookieSnack from "../../weapons/cookie-snack.json";
import drillHat from "../../weapons/drill-hat.json";
import firecrackerBundle from "../../weapons/firecracker-bundle.json";
import fizzGrenade from "../../weapons/fizz-grenade.json";
import hopperBall from "../../weapons/hopper-ball.json";
import jellyMine from "../../weapons/jelly-mine.json";
import pepperShotgun from "../../weapons/pepper-shotgun.json";
import pineconePopper from "../../weapons/pinecone-popper.json";
import pineconeSeed from "../../weapons/pinecone-seed.json";
import ropeClaw from "../../weapons/rope-claw.json";
import rootPunch from "../../weapons/root-punch.json";
import skipTurn from "../../weapons/skip-turn.json";
import sodaJetpack from "../../weapons/soda-jetpack.json";
import springBoots from "../../weapons/spring-boots.json";
import teleportBurrow from "../../weapons/teleport-burrow.json";
import umbrellaGlide from "../../weapons/umbrella-glide.json";
import fizzRocket from "../../weapons/fizz-rocket.json";
import paperPlaneSeeker from "../../weapons/paper-plane-seeker.json";
import slingshot from "../../weapons/slingshot.json";
import gumballCluster from "../../weapons/gumball-cluster.json";
import gumball from "../../weapons/gumball.json";
import snowGlobe from "../../weapons/snow-globe.json";
import hotSauceFlask from "../../weapons/hot-sauce-flask.json";
import gluePuddle from "../../weapons/glue-puddle.json";
import featherCharm from "../../weapons/feather-charm.json";
import windUpRobot from "../../weapons/wind-up-robot.json";
import marbleRoller from "../../weapons/marble-roller.json";
import rcRacer from "../../weapons/rc-racer.json";
import kiteBomber from "../../weapons/kite-bomber.json";
import kiteCharge from "../../weapons/kite-charge.json";
import peaGatling from "../../weapons/pea-gatling.json";
import waterPistol from "../../weapons/water-pistol.json";
import spatulaSwat from "../../weapons/spatula-swat.json";
import pillowBash from "../../weapons/pillow-bash.json";
import mousetrapSnapper from "../../weapons/mousetrap-snapper.json";
import type { WeaponData } from "./types";

/** Every weapon id, sub-munitions included. The keys of the registry are exactly these. */
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
  | "skip-turn"
  | "pinecone-popper"
  | "pinecone-seed"
  | "hopper-ball"
  | "beehive-bomb"
  | "firecracker-bundle"
  | "soda-jetpack"
  | "umbrella-glide"
  | "build-block"
  | "bubble-shield"
  | "cookie-snack"
  | "fizz-rocket"
  | "paper-plane-seeker"
  | "slingshot"
  | "gumball-cluster"
  | "gumball"
  | "snow-globe"
  | "hot-sauce-flask"
  | "glue-puddle"
  | "feather-charm"
  | "wind-up-robot"
  | "marble-roller"
  | "rc-racer"
  | "kite-bomber"
  | "kite-charge"
  | "pea-gatling"
  | "water-pistol"
  | "spatula-swat"
  | "pillow-bash"
  | "mousetrap-snapper";

export type WeaponRegistry = Readonly<Record<WeaponId, WeaponData>>;

/** Casts a raw JSON import to WeaponData. The schema check lives in weapons.test.ts. */
function toWeaponData(json: Record<string, unknown>): WeaponData {
  return json as unknown as WeaponData;
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
  "pinecone-popper": toWeaponData(pineconePopper),
  "pinecone-seed": toWeaponData(pineconeSeed),
  "hopper-ball": toWeaponData(hopperBall),
  "beehive-bomb": toWeaponData(beehiveBomb),
  "firecracker-bundle": toWeaponData(firecrackerBundle),
  "soda-jetpack": toWeaponData(sodaJetpack),
  "umbrella-glide": toWeaponData(umbrellaGlide),
  "build-block": toWeaponData(buildBlock),
  "bubble-shield": toWeaponData(bubbleShield),
  "cookie-snack": toWeaponData(cookieSnack),
  "fizz-rocket": toWeaponData(fizzRocket),
  "paper-plane-seeker": toWeaponData(paperPlaneSeeker),
  slingshot: toWeaponData(slingshot),
  "gumball-cluster": toWeaponData(gumballCluster),
  gumball: toWeaponData(gumball),
  "snow-globe": toWeaponData(snowGlobe),
  "hot-sauce-flask": toWeaponData(hotSauceFlask),
  "glue-puddle": toWeaponData(gluePuddle),
  "feather-charm": toWeaponData(featherCharm),
  "wind-up-robot": toWeaponData(windUpRobot),
  "marble-roller": toWeaponData(marbleRoller),
  "rc-racer": toWeaponData(rcRacer),
  "kite-bomber": toWeaponData(kiteBomber),
  "kite-charge": toWeaponData(kiteCharge),
  "pea-gatling": toWeaponData(peaGatling),
  "water-pistol": toWeaponData(waterPistol),
  "spatula-swat": toWeaponData(spatulaSwat),
  "pillow-bash": toWeaponData(pillowBash),
  "mousetrap-snapper": toWeaponData(mousetrapSnapper),
});

/** Returns the weapon registry, keyed by weapon id. The same frozen object every time. */
export function loadWeapons(): WeaponRegistry {
  return registry;
}
