// Weapon wave 1a in the sim: the Pinecone Popper (cluster, impact or mid-air trigger), the Hopper
// Ball (bouncy, blast grows per bounce) and the Beehive Strike (bombs dropped on a target line).

import { describe, expect, it } from "vitest";
import { FIXED_ONE } from "../fixed";
import { weaponCatalog } from "../weapons/catalog";
import { loadWeapons } from "../weapons/load";
import type { CritterInput, FireCommand, SimEvent, SimState } from "./api";
import { cell } from "./critter";
import { TRIGGER_MIN_AGE, blastRadius, explode } from "./projectile";
import { flatSlab } from "./terrainOps";
import { createCritter, createWorld, isSettled, stepWorld } from "./world";

const rng = { nextInt: () => 0 };
const GROUND = 20;

function world(extra = false): SimState {
  const t = flatSlab(128, 96, 128, GROUND, 4);
  const cs = [createCritter(1, 0, 40, GROUND, 64)];
  if (extra) cs.push(createCritter(2, 1, 100, GROUND, 64));
  let s = createWorld(t, cs);
  for (let i = 0; i < 2; i++) s = stepWorld(s, [], rng).state;
  return s;
}

function run(
  s: SimState,
  ticks: number,
  input: (tick: number, s: SimState) => readonly CritterInput[] = () => [],
): { state: SimState; events: SimEvent[]; peak: number } {
  const events: SimEvent[] = [];
  let peak = 0;
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(s, input(i, s), rng);
    s = r.state;
    events.push(...r.events);
    peak = Math.max(peak, s.projectiles.length);
  }
  return { state: s, events, peak };
}

const fireOnce =
  (fire: FireCommand, extra: (tick: number) => Partial<CritterInput> = () => ({})) =>
  (tick: number): CritterInput[] => [
    { critterId: 1, moveYaw: -1, ...(tick === 0 ? { fire } : {}), ...extra(tick) },
  ];

const explosions = (es: SimEvent[]) =>
  es.filter((e): e is Extract<SimEvent, { type: "explosion" }> => e.type === "explosion");

describe("Pinecone Popper", () => {
  const lob: FireCommand = { weaponId: "pinecone-popper", yaw: 0, pitch: 45, power: 40 };

  it("pops on impact into five seeds, each of which explodes", () => {
    const r = run(world(), 600, fireOnce(lob));
    const ex = explosions(r.events);
    expect(ex.filter((e) => e.weaponId === "pinecone-popper")).toHaveLength(1);
    expect(ex.filter((e) => e.weaponId === "pinecone-seed")).toHaveLength(5);
    expect(r.state.projectiles).toHaveLength(0);
    expect(r.state.nextProjectileId).toBe(1 + 1 + 5);
    // The seeds scatter: five different craters around the burst.
    const seeds = ex.filter((e) => e.weaponId === "pinecone-seed").map((e) => e.edit);
    expect(new Set(seeds.map((e) => `${"x" in e ? e.x : 0},${"z" in e ? e.z : 0}`)).size).toBe(5);
  });

  it("pops mid-air when its owner sends trigger, keeping some of its speed", () => {
    const up: FireCommand = { weaponId: "pinecone-popper", yaw: 0, pitch: 70, power: 60 };
    const r = run(
      world(),
      600,
      fireOnce(up, (tick) => (tick === 20 ? { trigger: true } : {})),
    );
    const pop = explosions(r.events).find((e) => e.weaponId === "pinecone-popper")!;
    const edit = pop.edit as { x: number; y: number };
    expect(edit.y).toBeGreaterThan(GROUND + 10); // well above the ground
    expect(explosions(r.events).filter((e) => e.weaponId === "pinecone-seed")).toHaveLength(5);
    // The seeds carried the popper's forward speed: their craters are ahead of the burst on average.
    const seeds = explosions(r.events)
      .filter((e) => e.weaponId === "pinecone-seed")
      .map((e) => (e.edit as { x: number }).x);
    expect(seeds.reduce((a, b) => a + b, 0) / 5).toBeGreaterThan(edit.x);
  });

  it("ignores trigger right after firing, and from anyone but the owner", () => {
    const up: FireCommand = { weaponId: "pinecone-popper", yaw: 0, pitch: 70, power: 60 };
    const early = run(
      world(),
      40,
      fireOnce(up, (t) => (t === TRIGGER_MIN_AGE - 2 ? { trigger: true } : {})),
    );
    expect(explosions(early.events)).toHaveLength(0);

    const other = run(world(true), 40, (tick) => [
      { critterId: 1, moveYaw: -1, ...(tick === 0 ? { fire: up } : {}) },
      { critterId: 2, moveYaw: -1, ...(tick === 20 ? { trigger: true } : {}) },
    ]);
    expect(explosions(other.events)).toHaveLength(0);
  });

  it("pops on impact if nobody triggers it", () => {
    const r = run(
      world(),
      600,
      fireOnce(lob, () => ({})),
    );
    const pop = explosions(r.events).find((e) => e.weaponId === "pinecone-popper")!;
    expect((pop.edit as { y: number }).y).toBeLessThanOrEqual(GROUND + 2);
  });
});

describe("Hopper Ball", () => {
  it("bounces many times and its blast grows by one voxel per bounce, up to four", () => {
    const r = run(
      world(),
      600,
      fireOnce({ weaponId: "hopper-ball", yaw: 0, pitch: 60, power: 30, fuseSeconds: 1 }),
    );
    const bounces = r.events.filter((e) => e.type === "bounced").length;
    expect(bounces).toBeGreaterThan(4);
    const ex = explosions(r.events);
    expect(ex).toHaveLength(1);
    const base = blastRadius(loadWeapons()["hopper-ball"]);
    expect((ex[0]!.edit as { r: number }).r).toBe(base + 4);
  });

  it("has a fixed 4 s fuse whatever fuse is asked for", () => {
    for (const fuseSeconds of [1, 5]) {
      let blastTick = -1;
      let s = world();
      for (let i = 0; i < 400 && blastTick < 0; i++) {
        const r = stepWorld(
          s,
          i === 0
            ? [
                {
                  critterId: 1,
                  moveYaw: -1,
                  fire: { weaponId: "hopper-ball", yaw: 0, pitch: 60, power: 30, fuseSeconds },
                },
              ]
            : [],
          rng,
        );
        s = r.state;
        if (r.events.some((e) => e.type === "explosion")) blastTick = i;
      }
      // The fuse counts down from the tick after the shot, as for every fused weapon.
      expect(blastTick).toBe(4 * 60 - 1);
    }
  });

  it("grows with each bounce: 0, 2 and 9 bounces blast at base, base + 2 and base + 4", () => {
    const base = blastRadius(loadWeapons()["hopper-ball"]);
    for (const [bounces, want] of [
      [0, base],
      [2, base + 2],
      [9, base + 4],
    ] as const) {
      const s = world();
      const p = {
        id: 9,
        ownerId: 1,
        weaponId: "hopper-ball" as const,
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        age: 0,
        fuseTicks: 0,
        bounces,
        resting: true,
      };
      const events: SimEvent[] = [];
      explode(s.terrain, s.critters, p, 64, GROUND, 64, events);
      expect((explosions(events)[0]!.edit as { r: number }).r).toBe(want);
    }
  });
});

describe("Beehive Strike", () => {
  const target = { x: 80, y: GROUND, z: 64 };

  it("does nothing without a target", () => {
    const r = run(world(), 5, fireOnce({ weaponId: "beehive-strike", yaw: 0, pitch: 0, power: 0 }));
    expect(r.events.some((e) => e.type === "fired")).toBe(false);
    expect(r.state.projectiles).toHaveLength(0);
  });

  it("drops five bombs in a line along the aim heading, centred on the target", () => {
    const yaw = 256; // +z: the line runs along z through the target
    const r = run(
      world(),
      900,
      fireOnce({ weaponId: "beehive-strike", yaw, pitch: 0, power: 0, target }),
    );
    expect(r.events.filter((e) => e.type === "fired")).toHaveLength(1);
    expect(r.peak).toBe(5);
    const ex = explosions(r.events);
    expect(ex).toHaveLength(5);
    expect(ex.every((e) => e.weaponId === "beehive-bomb")).toBe(true);
    const at = ex.map((e) => e.edit as { x: number; y: number; z: number });
    for (const e of at) {
      expect(Math.abs(e.x - target.x)).toBeLessThanOrEqual(1);
      expect(e.y).toBeLessThanOrEqual(GROUND + 1);
    }
    const zs = at.map((e) => e.z).sort((a, b) => a - b);
    expect(Math.abs((zs[0]! + zs[4]!) / 2 - target.z)).toBeLessThanOrEqual(1);
    expect(zs[4]! - zs[0]!).toBeGreaterThan(30);
    // They land one after another, not all at once.
    const ticks = new Set<number>();
    let s = world();
    for (let i = 0; i < 900; i++) {
      const step = stepWorld(
        s,
        i === 0
          ? [
              {
                critterId: 1,
                moveYaw: -1,
                fire: { weaponId: "beehive-strike", yaw, pitch: 0, power: 0, target },
              },
            ]
          : [],
        rng,
      );
      s = step.state;
      if (step.events.some((e) => e.type === "explosion")) ticks.add(i);
    }
    expect(ticks.size).toBeGreaterThan(1);
  });

  it("damages a critter standing on the target", () => {
    const r = run(
      world(true),
      900,
      fireOnce({
        weaponId: "beehive-strike",
        yaw: 256,
        pitch: 0,
        power: 0,
        target: { x: 100, y: GROUND, z: 64 },
      }),
    );
    const hurt = r.events.filter((e) => e.type === "damage" && e.critterId === 2);
    expect(hurt.length).toBeGreaterThan(0);
  });
});

describe("Firecracker Bundle", () => {
  const drop: CritterInput = {
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "firecracker-bundle", yaw: 0, pitch: 0, power: 0 },
  };

  it("is set down next to the critter and goes off after 5 s", () => {
    let s = stepWorld(world(), [drop], rng).state;
    expect(s.projectiles).toHaveLength(1);
    const p = s.projectiles[0]!;
    const c = s.critters[0]!;
    expect(Math.abs(cell(p.pos.x) - cell(c.pos.x))).toBeLessThanOrEqual(3);
    expect(Math.abs(cell(p.pos.z) - cell(c.pos.z))).toBeLessThanOrEqual(3);
    let blastTick = -1;
    for (let i = 1; i < 400 && blastTick < 0; i++) {
      const r = stepWorld(s, [], rng);
      s = r.state;
      if (r.events.some((e) => e.type === "explosion")) blastTick = i;
    }
    expect(blastTick).toBe(5 * 60 - 1);
    expect(s.projectiles).toHaveLength(0);
  });

  it("is lit early by another blast that reaches it", () => {
    let s = stepWorld(world(), [drop], rng).state;
    for (let i = 0; i < 30; i++) s = stepWorld(s, [], rng).state;
    const bundle = s.projectiles[0]!;
    const grenade = { ...bundle, id: 99, weaponId: "fizz-grenade" as const, fuseTicks: 2 };
    s = { ...s, projectiles: [bundle, grenade] };
    const blasts: number[] = [];
    for (let i = 0; i < 120; i++) {
      const r = stepWorld(s, [], rng);
      s = r.state;
      for (const e of r.events) if (e.type === "explosion") blasts.push(i);
    }
    expect(blasts).toHaveLength(2);
    const chain = loadWeapons()["firecracker-bundle"].params.chainFuseTicks as number;
    expect(blasts[1]! - blasts[0]!).toBeLessThanOrEqual(chain + 1);
    expect(blasts[1]! - blasts[0]!).toBeGreaterThan(0);
  });

  it("is not lit by a blast that is far away", () => {
    let s = stepWorld(world(), [drop], rng).state;
    const bundle = s.projectiles[0]!;
    const far = {
      ...bundle,
      id: 99,
      weaponId: "fizz-grenade" as const,
      fuseTicks: 2,
      pos: { ...bundle.pos, x: bundle.pos.x + 60 * FIXED_ONE },
    };
    s = { ...s, projectiles: [bundle, far] };
    for (let i = 0; i < 60; i++) s = stepWorld(s, [], rng).state;
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]!.fuseTicks).toBeGreaterThan(200);
  });
});

describe("Pepper Shotgun", () => {
  const shot = (pitch: number): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "pepper-shotgun", yaw: 0, pitch, power: 0 },
  });

  it("hits the moment it fires: two tracers, no projectile, a hole in the ground", () => {
    const r = stepWorld(world(), [shot(-20)], rng);
    expect(r.state.projectiles).toHaveLength(0);
    const fired = r.events.filter((e) => e.type === "fired");
    expect(fired).toHaveLength(1);
    expect((fired[0] as { projectileId: number }).projectileId).toBe(-1);
    const tracers = r.events.filter((e) => e.type === "tracer");
    expect(tracers).toHaveLength(2);
    expect(tracers.every((e) => e.type === "tracer" && e.hit)).toBe(true);
    expect(explosions([...r.events])).toHaveLength(2);
    // Aimed along +x and down: both pellets land ahead of the shooter, side by side.
    for (const e of tracers) {
      if (e.type !== "tracer") continue;
      expect(e.to.x).toBeGreaterThan(e.from.x);
      expect(cell(e.to.y)).toBeLessThan(GROUND + 1);
    }
  });

  it("damages a critter standing in the line of fire and not the shooter", () => {
    const r = stepWorld(world(true), [shot(0)], rng);
    const hurt = r.events.filter((e) => e.type === "damage");
    expect(hurt.length).toBeGreaterThan(0);
    expect(hurt.every((e) => e.type === "damage" && e.critterId === 2)).toBe(true);
    expect(r.state.critters[1]!.hp).toBeLessThan(100);
    expect(r.state.critters[0]!.hp).toBe(100);
  });

  it("misses into the sky without a blast", () => {
    const r = stepWorld(world(), [shot(60)], rng);
    const tracers = r.events.filter((e) => e.type === "tracer");
    expect(tracers).toHaveLength(2);
    expect(tracers.some((e) => e.type === "tracer" && e.hit)).toBe(false);
    expect(explosions([...r.events])).toHaveLength(0);
  });
});

describe("Root Punch", () => {
  const near = (team: number, x: number): SimState => {
    const t = flatSlab(128, 96, 128, GROUND, 4);
    let s = createWorld(t, [
      createCritter(1, 0, 40, GROUND, 64),
      createCritter(2, team, x, GROUND, 64),
    ]);
    for (let i = 0; i < 2; i++) s = stepWorld(s, [], rng).state;
    return s;
  };
  const swing = (yaw = 0): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "root-punch", yaw, pitch: 0, power: 0 },
  });

  it("hurts and launches an enemy in reach, up and away from the puncher", () => {
    const r = stepWorld(near(1, 46), [swing()], rng);
    expect(r.events.map((e) => e.type)).toEqual(["fired", "punch", "damage"]);
    const hit = r.state.critters[1]!;
    expect(hit.hp).toBe(100 - loadWeapons()["root-punch"].damage);
    expect(hit.vel.y).toBeGreaterThan(0);
    expect(hit.vel.x).toBeGreaterThan(0);
    expect(r.state.critters[0]!.hp).toBe(100);
    const after = run(r.state, 240);
    expect(cell(after.state.critters[1]!.pos.x)).toBeGreaterThan(46);
  });

  it("spares team mates, critters out of reach and critters behind", () => {
    for (const s of [near(0, 46), near(1, 60), near(1, 34)]) {
      const r = stepWorld(s, [swing()], rng);
      expect(r.events.map((e) => e.type)).toEqual(["fired", "punch"]);
      expect(r.state.critters[1]!.hp).toBe(100);
    }
  });
});

describe("Teleport Burrow", () => {
  const dig = (target?: { x: number; y: number; z: number }): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: {
      weaponId: "teleport-burrow",
      yaw: 0,
      pitch: 0,
      power: 0,
      ...(target ? { target } : {}),
    },
  });

  it("comes up on the ground above a target inside the terrain, unhurt", () => {
    const r = stepWorld(world(), [dig({ x: 90, y: GROUND - 2, z: 30 })], rng);
    expect(r.events.map((e) => e.type)).toEqual(["fired", "teleported"]);
    const after = run(r.state, 60);
    const c = after.state.critters[0]!;
    expect([cell(c.pos.x), cell(c.pos.y), cell(c.pos.z)]).toEqual([90, GROUND, 30]);
    expect(c.hp).toBe(100);
    expect(c.grounded).toBe(true);
  });

  it("is refused without a target, off the map, or onto another critter", () => {
    const s = world(true);
    for (const g of [undefined, { x: 0, y: GROUND, z: 30 }, { x: 100, y: GROUND, z: 64 }]) {
      const r = stepWorld(s, [dig(g)], rng);
      expect(r.events.filter((e) => e.type === "fired")).toHaveLength(0);
      expect(cell(r.state.critters[0]!.pos.x)).toBe(40);
    }
  });
});

describe("Jelly Mine", () => {
  const drop: CritterInput = {
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "jelly-mine", yaw: 0, pitch: 0, power: 0 },
  };
  /** Put a critter somewhere else, standing. */
  const move = (s: SimState, id: number, x: number): SimState => ({
    ...s,
    critters: s.critters.map((c) =>
      c.id === id ? { ...c, pos: { ...c.pos, x: x * FIXED_ONE + FIXED_ONE / 2 } } : c,
    ),
  });

  it("blows on its own placer if they stay beside it past arming", () => {
    const r = run(stepWorld(world(), [drop], rng).state, 60 * 2 + 40);
    expect(r.events.filter((e) => e.type === "mineTriggered")).toHaveLength(1);
    expect(explosions(r.events)).toHaveLength(1);
    expect(r.state.critters[0]!.hp).toBeLessThan(100);
    expect(r.state.projectiles).toHaveLength(0);
  });

  it("lies in wait without holding up the turn, then goes off under whoever comes close", () => {
    let s = move(stepWorld(world(true), [drop], rng).state, 1, 10);
    const waited = run(s, 60 * 12);
    s = waited.state;
    expect(explosions(waited.events)).toHaveLength(0);
    expect(s.projectiles).toHaveLength(1);
    expect(isSettled(s)).toBe(true);
    const sprung = run(move(s, 2, 44), 30);
    expect(sprung.events.filter((e) => e.type === "mineTriggered")).toHaveLength(1);
    expect(explosions(sprung.events)).toHaveLength(1);
    expect(sprung.state.critters[1]!.hp).toBeLessThan(100);
    expect(sprung.state.critters[0]!.hp).toBe(100);
  });

  it("is set off by a blast that reaches it", () => {
    let s = move(stepWorld(world(), [drop], rng).state, 1, 10);
    s = run(s, 30).state;
    const mine = s.projectiles[0]!;
    const shell = {
      ...mine,
      id: 99,
      weaponId: "acorn-mortar" as const,
      pos: { ...mine.pos, y: mine.pos.y + 6 * FIXED_ONE },
      vel: { x: 0, y: -FIXED_ONE, z: 0 },
      resting: false,
    };
    const r = run({ ...s, projectiles: [mine, shell] }, 40);
    expect(explosions(r.events)).toHaveLength(2);
    expect(r.events.filter((e) => e.type === "mineTriggered")).toHaveLength(0);
    expect(r.state.projectiles).toHaveLength(0);
  });
});

describe("wave 1a determinism", () => {
  it("the same shots give the same state, event for event", () => {
    const script = (tick: number): CritterInput[] => [
      {
        critterId: 1,
        moveYaw: -1,
        ...(tick === 0
          ? { fire: { weaponId: "pinecone-popper", yaw: 100, pitch: 60, power: 55 } }
          : {}),
        ...(tick === 25 ? { trigger: true } : {}),
      },
    ];
    const a = run(world(true), 500, script);
    const b = run(world(true), 500, script);
    expect(b.events).toEqual(a.events);
    expect(b.state.critters).toEqual(a.state.critters);
    expect(Buffer.from(b.state.terrain.density).equals(Buffer.from(a.state.terrain.density))).toBe(
      true,
    );
    expect(cell(a.state.critters[0]!.pos.y)).toBeGreaterThan(0);
    expect(FIXED_ONE).toBe(65536);
  });
});

describe("weapon catalogue", () => {
  it("lists the fireable weapons with what each needs, then the sub-munitions", () => {
    const cat = weaponCatalog();
    const byId = Object.fromEntries(cat.map((w) => [w.id, w]));
    expect(cat.filter((w) => w.fireable).map((w) => w.id)).toEqual([
      "acorn-mortar",
      "pinecone-popper",
      "fizz-grenade",
      "hopper-ball",
      "beehive-strike",
      "firecracker-bundle",
      "pepper-shotgun",
      "root-punch",
      "teleport-burrow",
      "jelly-mine",
    ]);
    expect(byId["jelly-mine"]!.needs).toEqual([]);
    expect(byId["root-punch"]!.needs).toEqual([]);
    expect(byId["teleport-burrow"]!.needs).toEqual(["target"]);
    expect(byId["pepper-shotgun"]!.needs).toEqual([]);
    expect(byId["firecracker-bundle"]!.needs).toEqual([]);
    expect(byId["acorn-mortar"]!.needs).toEqual(["charge"]);
    expect(byId["pinecone-popper"]!.needs).toEqual(["trigger", "charge"]);
    expect(byId["fizz-grenade"]!.needs).toEqual(["fuse", "charge"]);
    expect(byId["hopper-ball"]!.needs).toEqual(["charge"]);
    expect(byId["beehive-strike"]!.needs).toEqual(["target"]);
    expect(byId["pinecone-seed"]!.fireable).toBe(false);
    expect(byId["beehive-bomb"]!.fireable).toBe(false);
    expect(cat.every((w) => w.name.length > 0 && w.description.length > 0)).toBe(true);
    expect(weaponCatalog()).toBe(cat);
  });
});
