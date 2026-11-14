// Weapon wave 1a in the sim: the Pinecone Popper (cluster, impact or mid-air trigger), the Hopper
// Ball (bouncy, blast grows per bounce) and the Beehive Strike (bombs dropped on a target line).

import { describe, expect, it } from "vitest";
import { FIXED_ONE } from "../fixed";
import { weaponCatalog } from "../weapons/catalog";
import { loadWeapons } from "../weapons/load";
import type { CritterInput, FireCommand, Projectile, SimEvent, SimState } from "./api";
import { zonesTurnEnd } from "./zones";
import { cell } from "./critter";
import { TRIGGER_MIN_AGE, blastRadius, explode } from "./projectile";
import { applyEdit, flatSlab, isSolid } from "./terrainOps";
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

describe("Drill Hat", () => {
  const drill = (pitch: number, yaw = 0): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "drill-hat", yaw, pitch, power: 0 },
  });
  /** A solid wall across the +x heading, in front of critter 1 (at x 40). */
  const walled = (): SimState => {
    const s = world();
    applyEdit(s.terrain, {
      op: "box",
      x0: 46,
      y0: GROUND,
      z0: 40,
      x1: 90,
      y1: GROUND + 20,
      z1: 90,
    });
    return s;
  };

  it("tunnels level through a wall along the aim heading for three seconds", () => {
    const r = run(stepWorld(walled(), [drill(0)], rng).state, 200);
    const c = r.state.critters[0]!;
    // 3 s at 60 cells/s (18 voxels/s after the 3/10 length scale) is about 54 voxels.
    expect(cell(c.pos.x)).toBeGreaterThan(40 + 45);
    expect(cell(c.pos.y)).toBe(GROUND);
    expect(cell(c.pos.z)).toBe(64);
    expect(c.drillTicks).toBeUndefined();
    expect(isSolid(r.state.terrain, 60, GROUND + 2, 64)).toBe(false); // the tunnel is open
    expect(isSolid(r.state.terrain, 60, GROUND + 15, 64)).toBe(true); // the wall above stands
    expect(c.hp).toBe(100);
  });

  it("aimed low, drills straight down and stops above the soda", () => {
    const s = stepWorld(world(), [drill(-60)], rng).state;
    expect(s.critters[0]!.drillTicks).toBeGreaterThan(0);
    const r = run(s, 200);
    const c = r.state.critters[0]!;
    expect(cell(c.pos.x)).toBe(40);
    expect(cell(c.pos.y)).toBeLessThan(GROUND - 10);
    expect(cell(c.pos.y)).toBeGreaterThanOrEqual(r.state.terrain.seaY);
    expect(c.drillTicks).toBeUndefined();
    expect(c.hp).toBe(100); // no fall damage from the dig
  });

  it("holds the world unsettled while drilling, and the critter cannot fire again meanwhile", () => {
    let s = stepWorld(walled(), [drill(0)], rng).state;
    expect(isSettled(s)).toBe(false);
    const again = stepWorld(
      s,
      [
        {
          critterId: 1,
          moveYaw: -1,
          fire: { weaponId: "acorn-mortar", yaw: 0, pitch: 45, power: 40 },
        },
      ],
      rng,
    );
    expect(again.events.filter((e) => e.type === "fired")).toHaveLength(0);
    s = run(again.state, 240).state;
    expect(isSettled(s)).toBe(true);
  });

  it("is refused in the air", () => {
    const s = world();
    const air = {
      ...s,
      critters: s.critters.map((c) => ({
        ...c,
        grounded: false,
        pos: { ...c.pos, y: c.pos.y + 20 * FIXED_ONE },
      })),
    };
    const r = stepWorld(air, [drill(0)], rng);
    expect(r.events.filter((e) => e.type === "fired")).toHaveLength(0);
  });

  it("is knocked out of the drill by a blast", () => {
    let s = run(stepWorld(walled(), [drill(0)], rng).state, 20).state;
    s = {
      ...s,
      critters: s.critters.map((c) => ({ ...c, vel: { x: FIXED_ONE, y: FIXED_ONE, z: 0 } })),
    };
    s = stepWorld(s, [], rng).state;
    expect(s.critters[0]!.drillTicks).toBeUndefined();
  });

  it("drills the same tunnel every time", () => {
    const a = run(stepWorld(walled(), [drill(0, 7)], rng).state, 200);
    const b = run(stepWorld(walled(), [drill(0, 7)], rng).state, 200);
    expect(b.events).toEqual(a.events);
    expect(b.state.critters).toEqual(a.state.critters);
    expect(Buffer.from(b.state.terrain.density).equals(Buffer.from(a.state.terrain.density))).toBe(
      true,
    );
  });
});

describe("movement gear", () => {
  const use = (weaponId: FireCommand["weaponId"], pitch = 0, yaw = 0): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId, yaw, pitch, power: 0 },
  });
  const fired = (es: readonly SimEvent[]) => es.filter((e) => e.type === "fired");
  const landings = (es: SimEvent[]) =>
    es.filter((e): e is Extract<SimEvent, { type: "landed" }> => e.type === "landed");
  /** Lift critter 1 `h` voxels into the air. */
  const lifted = (s: SimState, h: number): SimState => ({
    ...s,
    critters: s.critters.map((c) =>
      c.id === 1 ? { ...c, grounded: false, pos: { ...c.pos, y: c.pos.y + h * FIXED_ONE } } : c,
    ),
  });

  it("Spring Boots jump far higher than a jump and land softly", () => {
    const r0 = stepWorld(world(), [use("spring-boots", 80)], rng);
    expect(fired(r0.events)).toHaveLength(1);
    expect(r0.state.critters[0]!.safeFall).toBe(60);
    let top = 0;
    const r = run(r0.state, 400, (_t, s) => {
      top = Math.max(top, cell(s.critters[0]!.pos.y));
      return [];
    });
    expect(top - GROUND).toBeGreaterThan(30); // a plain jump is about 10
    const c = r.state.critters[0]!;
    expect(c.grounded).toBe(true);
    expect(c.safeFall).toBeUndefined();
    expect(c.hp).toBe(100);
    expect(landings(r.events)[0]!.fallDistance).toBe(0);
    expect(cell(c.pos.x)).toBeGreaterThan(40); // aimed along +x
  });

  it("Spring Boots are refused in the air", () => {
    expect(fired(stepWorld(lifted(world(), 20), [use("spring-boots", 80)], rng).events)).toEqual(
      [],
    );
  });

  it("the Soda Jetpack lifts off, bursts on each jump in the air, and runs out", () => {
    const r0 = stepWorld(world(), [use("soda-jetpack")], rng);
    expect(r0.state.critters[0]!.jetFuel).toBe(7);
    // Jump every 10 ticks: each one spends a burst while there is fuel.
    const r = run(r0.state, 100, (t) => [
      { critterId: 1, moveYaw: -1, ...(t % 10 === 5 ? { jump: true } : {}) },
    ]);
    const c = r.state.critters[0]!;
    expect(c.grounded).toBe(false);
    expect(c.jetFuel).toBe(0);
    expect(cell(c.pos.y) - GROUND).toBeGreaterThan(20); // bursts keep it climbing
    const down = run(r.state, 600);
    expect(down.state.critters[0]!.grounded).toBe(true);
    expect(down.state.critters[0]!.jetFuel).toBeUndefined();
  });

  it("the Umbrella Glide opens only mid-air, falls slowly, steers, and lands unhurt", () => {
    expect(fired(stepWorld(world(), [use("umbrella-glide")], rng).events)).toEqual([]);
    const high = lifted(world(), 30);
    const open = stepWorld(high, [use("umbrella-glide")], rng).state;
    expect(open.critters[0]!.umbrella).toBe(true);
    const r = run(open, 600, (_t, s) => [
      { critterId: 1, moveYaw: s.critters[0]!.grounded ? -1 : 0 },
    ]);
    const c = r.state.critters[0]!;
    expect(c.grounded).toBe(true);
    expect(c.umbrella).toBeUndefined();
    expect(c.hp).toBe(100);
    expect(cell(c.pos.x)).toBeGreaterThan(40 + 20); // drifted along +x on the way down
    // The same drop without the umbrella hurts.
    const bare = run(high, 300);
    expect(bare.state.critters[0]!.hp).toBeLessThan(100);
  });

  it("gear does not stack and keeps the world unsettled until landing", () => {
    const s = stepWorld(world(), [use("soda-jetpack")], rng).state;
    expect(isSettled(s)).toBe(false);
    expect(fired(stepWorld(s, [use("umbrella-glide")], rng).events)).toEqual([]);
  });
});

describe("Rope Claw", () => {
  const claw = (pitch: number): CritterInput => ({
    critterId: 1,
    moveYaw: -1,
    fire: { weaponId: "rope-claw", yaw: 0, pitch, power: 0 },
  });
  /** A slab hanging over +x of critter 1, 20 to 24 voxels up. */
  const roofed = (): SimState => {
    const s = world();
    applyEdit(s.terrain, {
      op: "box",
      x0: 50,
      y0: GROUND + 20,
      z0: 44,
      x1: 100,
      y1: GROUND + 24,
      z1: 84,
    });
    return s;
  };
  const dist = (c: SimState["critters"][number]) => {
    const a = c.rope!.anchor;
    const d = [c.pos.x - a.x, c.pos.y - a.y, c.pos.z - a.z].map((v) => v / FIXED_ONE);
    return Math.hypot(d[0]!, d[1]!, d[2]!);
  };

  it("grips the overhang, lifts the critter and holds it on the rope", () => {
    const r0 = stepWorld(roofed(), [claw(45)], rng);
    expect(r0.events.filter((e) => e.type === "fired")).toHaveLength(1);
    const rope = r0.state.critters[0]!.rope!;
    expect(cell(rope.anchor.y)).toBe(GROUND + 20);
    const r = run(r0.state, 120);
    const c = r.state.critters[0]!;
    expect(c.rope).toBeDefined();
    expect(c.grounded).toBe(false);
    expect(cell(c.pos.y)).toBeGreaterThan(GROUND + 2);
    expect(dist(c)).toBeLessThanOrEqual(rope.len / FIXED_ONE + 0.01);
    expect(c.hp).toBe(100);
  });

  it("lets go on jump and lands unhurt; misses with nothing in reach", () => {
    let s = run(stepWorld(roofed(), [claw(45)], rng).state, 60).state;
    s = stepWorld(s, [{ critterId: 1, moveYaw: -1, jump: true }], rng).state;
    expect(s.critters[0]!.rope).toBeUndefined();
    const down = run(s, 300);
    expect(down.state.critters[0]!.grounded).toBe(true);
    expect(down.state.critters[0]!.hp).toBe(100);
    const miss = stepWorld(world(), [claw(80)], rng);
    expect(miss.events.filter((e) => e.type === "fired")).toEqual([]);
  });

  it("swings further along the heading when pumped", () => {
    const s = run(stepWorld(roofed(), [claw(45)], rng).state, 30).state;
    const still = run(s, 90).state.critters[0]!;
    const pumped = run(s, 90, () => [{ critterId: 1, moveYaw: 0 }]).state.critters[0]!;
    expect(pumped.pos.x).toBeGreaterThan(still.pos.x);
  });

  it("lets go by itself after ten seconds", () => {
    const r = run(stepWorld(roofed(), [claw(45)], rng).state, 60 * 10 + 5);
    expect(r.state.critters[0]!.rope).toBeUndefined();
  });
});

describe("Build Block, Bubble Shield, Cookie Snack", () => {
  const use = (
    weaponId: FireCommand["weaponId"],
    target?: { x: number; y: number; z: number },
    critterId = 1,
  ): CritterInput => ({
    critterId,
    moveYaw: -1,
    fire: { weaponId, yaw: 0, pitch: 0, power: 0, ...(target ? { target } : {}) },
  });
  const fired = (es: readonly SimEvent[]) => es.filter((e) => e.type === "fired");

  it("Build Block puts a solid block on the target and refuses bad spots", () => {
    const s = world(true);
    const r = stepWorld(s, [use("build-block", { x: 60, y: GROUND, z: 64 })], rng);
    expect(fired(r.events)).toHaveLength(1);
    expect(isSolid(r.state.terrain, 60, GROUND + 2, 64)).toBe(true);
    expect(isSolid(r.state.terrain, 60, GROUND + 8, 64)).toBe(false);
    for (const g of [undefined, { x: 125, y: GROUND, z: 64 }, { x: 100, y: GROUND, z: 64 }]) {
      // no target; off the grid (and out of range); onto critter 2
      expect(fired(stepWorld(world(true), [use("build-block", g)], rng).events)).toEqual([]);
    }
  });

  it("a critter can stand on its block", () => {
    const s = stepWorld(world(), [use("build-block", { x: 40, y: GROUND, z: 70 })], rng).state;
    const on = {
      ...s,
      critters: s.critters.map((c) => ({
        ...c,
        pos: { ...c.pos, z: 70 * FIXED_ONE, y: c.pos.y + 10 * FIXED_ONE },
        grounded: false,
      })),
    };
    const c = run(on, 60).state.critters[0]!;
    expect(c.grounded).toBe(true);
    expect(cell(c.pos.y)).toBe(GROUND + 4);
  });

  it("Bubble Shield soaks up one blast whole, then pops", () => {
    let s = stepWorld(world(), [use("bubble-shield")], rng).state;
    expect(s.critters[0]!.shield).toBe(true);
    expect(fired(stepWorld(s, [use("bubble-shield")], rng).events)).toEqual([]);
    const c0 = s.critters[0]!;
    const ev: SimEvent[] = [];
    const shell = {
      id: 9,
      ownerId: 2,
      weaponId: "acorn-mortar" as const,
      pos: c0.pos,
      vel: { x: 0, y: 0, z: 0 },
      age: 0,
      fuseTicks: -1,
      bounces: 0,
      resting: false,
    };
    const at = [cell(c0.pos.x), cell(c0.pos.y), cell(c0.pos.z)] as const;
    s = { ...s, critters: explode(s.terrain, s.critters, shell, ...at, ev) };
    expect(ev.map((e) => e.type)).toContain("shieldPopped");
    expect(ev.filter((e) => e.type === "damage")).toEqual([]);
    expect(s.critters[0]!.hp).toBe(100);
    expect(s.critters[0]!.shield).toBeUndefined();
    const ev2: SimEvent[] = [];
    s = { ...s, critters: explode(s.terrain, s.critters, shell, ...at, ev2) };
    expect(s.critters[0]!.hp).toBeLessThan(100);
  });

  it("Cookie Snack heals the most hurt of self and a teammate beside, capped at full", () => {
    const t = flatSlab(128, 96, 128, GROUND, 4);
    const cs = [
      { ...createCritter(1, 0, 40, GROUND, 64), hp: 90 },
      { ...createCritter(2, 0, 44, GROUND, 64), hp: 50 },
      { ...createCritter(3, 1, 42, GROUND, 64), hp: 10 }, // an enemy: never fed
    ];
    let s = createWorld(t, cs);
    let r = stepWorld(s, [use("cookie-snack")], rng);
    expect(r.events.find((e) => e.type === "healed")).toEqual({
      type: "healed",
      critterId: 2,
      amount: 25,
    });
    s = { ...r.state, critters: r.state.critters.map((c) => (c.id === 2 ? { ...c, hp: 100 } : c)) };
    r = stepWorld(s, [use("cookie-snack")], rng);
    expect(r.events.find((e) => e.type === "healed")).toEqual({
      type: "healed",
      critterId: 1,
      amount: 10,
    });
    expect(r.state.critters[0]!.hp).toBe(100);
  });
});

describe("rockets and seekers", () => {
  const shoot = (fire: FireCommand) => fireOnce(fire);

  it("Fizz Rocket flies dead level for a second, then drops", () => {
    let s = stepWorld(
      world(),
      [
        {
          critterId: 1,
          moveYaw: -1,
          fire: { weaponId: "fizz-rocket", yaw: 0, pitch: 0, power: 30 },
        },
      ],
      rng,
    ).state;
    const y0 = s.projectiles[0]!.pos.y;
    s = run(s, 50).state;
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]!.pos.y).toBe(y0);
    const r = run(s, 400);
    expect(explosions(r.events)).toHaveLength(1);
  });

  it("Paper Plane Seeker needs a mark and comes down on it", () => {
    const none = stepWorld(
      world(),
      [
        {
          critterId: 1,
          moveYaw: -1,
          fire: { weaponId: "paper-plane-seeker", yaw: 0, pitch: 45, power: 0 },
        },
      ],
      rng,
    );
    expect(none.events.filter((e) => e.type === "fired")).toEqual([]);
    // Launched the wrong way (yaw 512 = -x): it still turns and finds the mark at +x.
    const target = { x: 90, y: GROUND - 1, z: 80 };
    const r = run(
      world(),
      900,
      shoot({ weaponId: "paper-plane-seeker", yaw: 512, pitch: 30, power: 0, target }),
    );
    const ex = explosions(r.events);
    expect(ex).toHaveLength(1);
    const e = ex[0]!.edit as { x: number; z: number };
    expect(Math.abs(e.x - target.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(e.z - target.z)).toBeLessThanOrEqual(4);
  });

  it("Slingshot ignores the wind", () => {
    const shot: FireCommand = { weaponId: "slingshot", yaw: 0, pitch: 40, power: 40 };
    const calm = run(world(), 400, shoot(shot));
    const windy = run({ ...world(), windX: 0, windZ: 100 }, 400, shoot(shot));
    expect(explosions(windy.events)[0]!.edit).toEqual(explosions(calm.events)[0]!.edit);
  });

  it("Gumball Cluster bursts into gumballs that stick, then pop", () => {
    const jar: FireCommand = { weaponId: "gumball-cluster", yaw: 0, pitch: 45, power: 30 };
    let s = run(world(), 3 * 60 + 2, shoot(jar)).state;
    expect(s.projectiles.filter((p) => p.weaponId === "gumball").length).toBe(6);
    s = run(s, 60).state;
    const stuck = s.projectiles.filter((p) => p.resting);
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.every((p) => p.fuseTicks > 0)).toBe(true);
    const r = run(s, 400);
    expect(explosions(r.events).filter((e) => e.weaponId === "gumball")).toHaveLength(6);
    expect(r.state.projectiles).toHaveLength(0);
  });
});

describe("status and zones", () => {
  const shoot = (fire: FireCommand) => fireOnce(fire);
  /** Put a projectile of `weaponId` right on top of critter `id` (impact at once). */
  const dropOn = (s: SimState, weaponId: Projectile["weaponId"], id = 2): SimState => {
    const c = s.critters.find((k) => k.id === id)!;
    return {
      ...s,
      projectiles: [
        {
          id: 50,
          ownerId: 1,
          weaponId,
          pos: { ...c.pos, y: c.pos.y + 8 * FIXED_ONE },
          vel: { x: 0, y: -FIXED_ONE, z: 0 },
          age: 30,
          fuseTicks: weaponId === "snow-globe" ? 1 : -1,
          bounces: 0,
          resting: false,
        },
      ],
      nextProjectileId: 51,
    };
  };

  it("Snow Globe freezes without damage or a crater, and a frozen critter does nothing", () => {
    const before = world(true);
    const r = run(dropOn(before, "snow-globe"), 10);
    expect(r.events.filter((e) => e.type === "frozen").map((e) => e.critterId)).toEqual([2]);
    const c = r.state.critters[1]!;
    expect(c.frozen).toBe(true);
    expect(c.hp).toBe(100);
    expect(isSolid(r.state.terrain, 100, GROUND - 1, 64)).toBe(true);
    const tried = run(r.state, 30, () => [
      {
        critterId: 2,
        moveYaw: 0,
        fire: { weaponId: "acorn-mortar", yaw: 0, pitch: 45, power: 50 },
      },
    ]);
    expect(tried.events.filter((e) => e.type === "fired")).toEqual([]);
    expect(tried.state.critters[1]!.pos.x).toBe(c.pos.x);
  });

  it("Hot Sauce Flask and Glue Puddle leave puddles; glue stops walking but not firing", () => {
    const fire = run(dropOn(world(true), "hot-sauce-flask"), 10).state;
    expect(fire.zones).toHaveLength(1);
    expect(fire.zones![0]).toMatchObject({ kind: "fire", turns: 3, r: 12 });
    const glued = run(dropOn(world(true), "glue-puddle"), 10).state;
    expect(glued.zones![0]).toMatchObject({ kind: "glue", turns: 2 });
    expect(glued.critters[1]!.hp).toBe(100);
    const r = run(glued, 30, (t) => [
      {
        critterId: 2,
        moveYaw: 0,
        ...(t === 0
          ? { fire: { weaponId: "acorn-mortar" as const, yaw: 0, pitch: 45, power: 50 } }
          : {}),
      },
    ]);
    expect(r.state.critters[1]!.pos.x).toBe(glued.critters[1]!.pos.x);
    expect(r.events.filter((e) => e.type === "fired")).toHaveLength(1);
  });

  it("zonesTurnEnd scorches critters in fire, dries puddles and lifts the Feather Charm", () => {
    let s = run(dropOn(world(true), "hot-sauce-flask"), 10).state;
    s = {
      ...s,
      critters: s.critters.map((c) => (c.id === 1 ? { ...c, feather: true as const } : c)),
    };
    const hp = s.critters[1]!.hp;
    for (let turn = 0; turn < 3; turn++) {
      const ev: SimEvent[] = [];
      s = zonesTurnEnd(s, ev);
      expect(ev).toEqual([{ type: "damage", critterId: 2, amount: 10, cause: "fire" }]);
    }
    expect(s.critters[1]!.hp).toBe(hp - 30);
    expect(s.zones).toBeUndefined();
    expect(s.critters[0]!.feather).toBeUndefined();
  });

  it("Feather Charm halves gravity for the critter and its shots", () => {
    const lob: FireCommand = { weaponId: "acorn-mortar", yaw: 0, pitch: 45, power: 30 };
    const plain = run(world(), 400, shoot(lob));
    const charm = stepWorld(
      world(),
      [
        {
          critterId: 1,
          moveYaw: -1,
          fire: { weaponId: "feather-charm", yaw: 0, pitch: 0, power: 0 },
        },
      ],
      rng,
    ).state;
    expect(charm.critters[0]!.feather).toBe(true);
    const light = run(charm, 600, shoot(lob));
    const far = (r: typeof plain) => (explosions(r.events)[0]!.edit as { x: number }).x;
    expect(far(light)).toBeGreaterThan(far(plain) + 10);
  });
});

describe("walkers and steerables", () => {
  const send = (fire: FireCommand, extra: (tick: number) => Partial<CritterInput> = () => ({})) =>
    fireOnce(fire, extra);

  it("Wind-up Robot marches along the aim, climbs a small step, turns at a wall, blows at 8 s", () => {
    const s = world();
    applyEdit(s.terrain, { op: "box", x0: 50, y0: GROUND, z0: 54, x1: 54, y1: GROUND + 1, z1: 74 });
    applyEdit(s.terrain, {
      op: "box",
      x0: 70,
      y0: GROUND,
      z0: 54,
      x1: 72,
      y1: GROUND + 15,
      z1: 74,
    });
    let maxX = 0;
    let maxY = 0;
    const r = run(s, 8 * 60 + 5, (tick, st) => {
      const p = st.projectiles[0];
      if (p) {
        maxX = Math.max(maxX, cell(p.pos.x));
        maxY = Math.max(maxY, cell(p.pos.y));
      }
      return send({ weaponId: "wind-up-robot", yaw: 0, pitch: 0, power: 0 })(tick);
    });
    expect(maxY).toBe(GROUND + 2); // up the step
    expect(maxX).toBeLessThan(70); // never through the wall
    expect(maxX).toBeGreaterThan(60);
    const ex = explosions(r.events);
    expect(ex).toHaveLength(1);
    expect((ex[0]!.edit as { x: number }).x).toBeLessThan(maxX); // came back from the wall
  });

  it("Wind-up Robot blows early on a click", () => {
    const r = run(
      world(),
      60,
      send({ weaponId: "wind-up-robot", yaw: 0, pitch: 0, power: 0 }, (t) =>
        t === 30 ? { trigger: true } : {},
      ),
    );
    expect(explosions(r.events)).toHaveLength(1);
  });

  it("Marble Roller rolls down the stairs and keeps going on the flat", () => {
    const s = world();
    // Stairs falling toward +x: one voxel down every three.
    for (let i = 0; i < 8; i++)
      applyEdit(s.terrain, {
        op: "box",
        x0: 30,
        y0: GROUND,
        z0: 54,
        x1: 33 + i * 3,
        y1: GROUND + 7 - i,
        z1: 74,
      });
    const placed = {
      ...s,
      critters: s.critters.map((c) => ({ ...c, pos: { ...c.pos, x: 20 * FIXED_ONE } })),
      projectiles: [
        {
          id: 1,
          ownerId: 1,
          weaponId: "marble-roller" as const,
          pos: { x: 31 * FIXED_ONE, y: (GROUND + 9) * FIXED_ONE, z: 64 * FIXED_ONE },
          vel: { x: FIXED_ONE >> 1, y: 0, z: 0 },
          age: 0,
          fuseTicks: 6 * 60,
          bounces: 0,
          resting: false,
        },
      ],
      nextProjectileId: 2,
    };
    const r = run(placed, 6 * 60 + 2);
    const ex = explosions(r.events);
    expect(ex).toHaveLength(1);
    const end = ex[0]!.edit as { x: number; y: number };
    expect(end.x).toBeGreaterThan(70); // down the stairs and on across the flat
    expect(end.y).toBeLessThanOrEqual(GROUND + 1);
  });

  it("RC Racer follows its driver's walk keys while the driver stands still", () => {
    const go = send({ weaponId: "rc-racer", yaw: 0, pitch: 0, power: 0 }, (t) =>
      t >= 1 ? { moveYaw: 256 } : {},
    );
    const r = run(world(), 120, go);
    const car = r.state.projectiles[0]!;
    expect(cell(car.pos.z)).toBeGreaterThan(64 + 10); // drove toward +z
    expect(cell(r.state.critters[0]!.pos.x)).toBe(40);
    expect(cell(r.state.critters[0]!.pos.z)).toBe(64);
    const r2 = run(r.state, 8 * 60);
    expect(explosions(r2.events)).toHaveLength(1);
  });

  it("Kite Bomber flies where it is steered, with the wind, and drops its charge on a click", () => {
    const fly = send({ weaponId: "kite-bomber", yaw: 0, pitch: 30, power: 0 }, (t) => ({
      ...(t >= 1 ? { moveYaw: 0 } : {}),
      ...(t === 120 ? { trigger: true } : {}),
    }));
    const calm = run(world(), 400, fly);
    const windy = run({ ...world(), windX: 100, windZ: 0 }, 400, fly);
    const at = (r: typeof calm) =>
      (explosions(r.events).find((e) => e.weaponId === "kite-charge")!.edit as { x: number }).x;
    expect(explosions(calm.events).map((e) => e.weaponId)).toEqual(["kite-bomber", "kite-charge"]);
    expect(at(windy)).toBeGreaterThan(at(calm));
    expect(calm.state.projectiles).toHaveLength(0);
  });
});

describe("guns and melee", () => {
  const fire = (fire: FireCommand): CritterInput => ({ critterId: 1, moveYaw: -1, fire });
  const near = (dx: number, dz = 0): SimState => {
    const s = world(true);
    return {
      ...s,
      critters: s.critters.map((c) =>
        c.id === 2
          ? {
              ...c,
              pos: {
                ...c.pos,
                x: (40 + dx) * FIXED_ONE + FIXED_ONE / 2,
                z: (64 + dz) * FIXED_ONE + FIXED_ONE / 2,
              },
            }
          : c,
      ),
    };
  };

  it("Pea Gatling sprays a stream for three seconds and sweeps with the walk keys", () => {
    const s = stepWorld(
      near(20),
      [fire({ weaponId: "pea-gatling", yaw: 0, pitch: 0, power: 0 })],
      rng,
    ).state;
    expect(s.critters[0]!.gatling).toBeDefined();
    expect(isSettled(s)).toBe(false);
    const r = run(s, 200, (t) => [{ critterId: 1, moveYaw: t > 90 ? 256 : -1 }]);
    const tracers = r.events.filter((e) => e.type === "tracer");
    expect(tracers).toHaveLength(30);
    expect(r.state.critters[0]!.gatling).toBeUndefined();
    expect(r.state.critters[0]!.yaw).toBe(256); // swept round
    expect(cell(r.state.critters[0]!.pos.x)).toBe(40); // without walking
    const hurt = r.events.filter((e) => e.type === "damage" && e.critterId === 2);
    expect(hurt.length).toBeGreaterThan(5);
    expect(hurt.length).toBeLessThan(30);
  });

  it("Water Pistol barely hurts but shoves hard, leaving the ground alone", () => {
    const s = stepWorld(
      near(20),
      [fire({ weaponId: "water-pistol", yaw: 0, pitch: 0, power: 0 })],
      rng,
    );
    const c2 = s.state.critters[1]!;
    expect(100 - c2.hp).toBeLessThanOrEqual(5);
    expect(c2.vel.x).toBeGreaterThan(FIXED_ONE);
    expect(s.state.terrain.edits).toHaveLength(0);
  });

  it("Spatula Swat hits in a frontal arc only; Pillow Bash shoves without hurting", () => {
    const swat = (s: SimState) =>
      stepWorld(s, [fire({ weaponId: "spatula-swat", yaw: 0, pitch: 0, power: 0 })], rng);
    expect(swat(near(8, 8)).state.critters[1]!.hp).toBe(75); // 45 degrees off: inside 120
    expect(swat(near(3, 12)).state.critters[1]!.hp).toBe(100); // 76 degrees off: outside
    const bash = stepWorld(
      near(8),
      [fire({ weaponId: "pillow-bash", yaw: 0, pitch: 0, power: 0 })],
      rng,
    );
    const c2 = bash.state.critters[1]!;
    expect(c2.hp).toBe(100);
    expect(c2.vel.x).toBeGreaterThan(3 * Math.abs(c2.vel.y));
  });

  it("Mousetrap Snapper waits, then snaps whoever steps on it high into the air", () => {
    const trap = (s: SimState) =>
      stepWorld(s, [fire({ weaponId: "mousetrap-snapper", yaw: 0, pitch: 0, power: 0 })], rng)
        .state;
    let s = trap(near(60));
    s = {
      ...s,
      critters: s.critters.map((c) =>
        c.id === 1 ? { ...c, pos: { ...c.pos, x: 10 * FIXED_ONE } } : c,
      ),
    };
    s = run(s, 120).state;
    expect(s.projectiles).toHaveLength(1);
    expect(isSettled(s)).toBe(true);
    const p = s.projectiles[0]!;
    s = {
      ...s,
      critters: s.critters.map((c) =>
        c.id === 2 ? { ...c, pos: { ...c.pos, x: p.pos.x, z: p.pos.z } } : c,
      ),
    };
    let top = 0;
    const r = run(s, 120, (_t, st) => {
      top = Math.max(top, cell(st.critters[1]!.pos.y));
      return [];
    });
    expect(r.events.filter((e) => e.type === "mineTriggered")).toHaveLength(1);
    expect(top - GROUND).toBeGreaterThan(20);
    expect(r.state.terrain.edits).toHaveLength(0);
  });
});

describe("air strikes and supers", () => {
  const at = (dx: number) => ({ x: 40 + dx, y: GROUND, z: 64 });
  const cmd = (
    weaponId: FireCommand["weaponId"],
    extra: Partial<FireCommand> = {},
  ): FireCommand => ({
    weaponId,
    yaw: 0,
    pitch: 0,
    power: 0,
    ...extra,
  });

  it("Lantern Drift drops three lanterns that the wind carries", () => {
    const calm = run(world(), 900, fireOnce(cmd("lantern-drift", { target: at(40) })));
    const windy = run(
      { ...world(), windX: 10 },
      900,
      fireOnce(cmd("lantern-drift", { target: at(40) })),
    );
    const xs = (r: typeof calm) =>
      explosions(r.events)
        .filter((e) => e.weaponId === "paper-lantern")
        .map((e) => (e.edit as { x: number }).x);
    expect(xs(calm)).toHaveLength(3);
    expect(xs(windy)).toHaveLength(3);
    const drift = xs(windy).map((x, i) => x - xs(calm)[i]!);
    expect(drift.every((d) => d > 5)).toBe(true);
  });

  it("Toy Block Drop lands a giant block that stays as new terrain", () => {
    const r = run(world(), 900, fireOnce(cmd("toy-block-drop", { target: at(30) })));
    expect(explosions(r.events).filter((e) => e.weaponId === "giant-block")).toHaveLength(1);
    expect(isSolid(r.state.terrain, 70, GROUND + 3, 64)).toBe(true);
  });

  it("Boulder of Doom grinds a tunnel and blows on reaching a critter", () => {
    const r = run(world(true), 900, fireOnce(cmd("boulder-of-doom")));
    const ex = explosions(r.events).filter((e) => e.weaponId === "boulder-of-doom");
    expect(ex).toHaveLength(1);
    expect(r.state.terrain.edits.length).toBeGreaterThan(2);
    expect(r.state.critters[1]!.hp).toBeLessThan(100);
  });

  it("Marble Meteor Shower rains twenty marbles over about four seconds", () => {
    const r = run(world(), 600, fireOnce(cmd("marble-meteor-shower")));
    const ex = explosions(r.events).filter((e) => e.weaponId === "meteor-marble");
    expect(r.events.filter((e) => e.type === "fired")).toHaveLength(1);
    expect(ex).toHaveLength(20);
    expect(r.state.projectiles).toHaveLength(0);
  });

  it("Party Pinata bursts into eight candy bombs", () => {
    const r = run(world(), 900, fireOnce(cmd("party-pinata", { target: at(40) })));
    const ex = explosions(r.events);
    expect(ex.filter((e) => e.weaponId === "pinata")).toHaveLength(1);
    expect(ex.filter((e) => e.weaponId === "candy-bomb")).toHaveLength(8);
  });

  it("Tabletop Quake hurts everyone and throws them out from the middle", () => {
    const r = stepWorld(world(true), [fireOnce(cmd("tabletop-quake"))(0)[0]!], rng);
    const [a, b] = r.state.critters;
    expect(a!.hp).toBe(90);
    expect(b!.hp).toBe(90);
    expect(a!.vel.x).toBeLessThan(0); // x 40: left of the middle
    expect(b!.vel.x).toBeGreaterThan(0); // x 100: right of it
    expect(a!.vel.y).toBeGreaterThan(0);
    expect(r.state.terrain.edits).toHaveLength(0);
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
      "drill-hat",
      "spring-boots",
      "soda-jetpack",
      "umbrella-glide",
      "rope-claw",
      "build-block",
      "bubble-shield",
      "cookie-snack",
      "fizz-rocket",
      "paper-plane-seeker",
      "slingshot",
      "gumball-cluster",
      "snow-globe",
      "hot-sauce-flask",
      "glue-puddle",
      "feather-charm",
      "wind-up-robot",
      "marble-roller",
      "rc-racer",
      "kite-bomber",
      "pea-gatling",
      "water-pistol",
      "spatula-swat",
      "pillow-bash",
      "mousetrap-snapper",
      "lantern-drift",
      "toy-block-drop",
      "boulder-of-doom",
      "marble-meteor-shower",
      "party-pinata",
      "tabletop-quake",
    ]);
    expect(byId["tabletop-quake"]!.crateOnly).toBe(true);
    expect(byId["acorn-mortar"]!.crateOnly).toBe(false);
    expect(byId["jelly-mine"]!.needs).toEqual([]);
    expect(byId["drill-hat"]!.needs).toEqual([]);
    expect(byId["root-punch"]!.needs).toEqual([]);
    expect(byId["teleport-burrow"]!.needs).toEqual(["target"]);
    expect(byId["pepper-shotgun"]!.needs).toEqual([]);
    expect(byId["firecracker-bundle"]!.needs).toEqual([]);
    expect(byId["acorn-mortar"]!.needs).toEqual(["charge"]);
    expect(byId["pinecone-popper"]!.needs).toEqual(["trigger", "charge"]);
    expect(byId["fizz-grenade"]!.needs).toEqual(["fuse", "charge"]);
    expect(byId["hopper-ball"]!.needs).toEqual(["charge"]);
    expect(byId["beehive-strike"]!.needs).toEqual(["target"]);
    expect(byId["build-block"]!.needs).toEqual(["target"]);
    expect(byId["cookie-snack"]!.needs).toEqual([]);
    expect(byId["pinecone-seed"]!.fireable).toBe(false);
    expect(byId["beehive-bomb"]!.fireable).toBe(false);
    expect(cat.every((w) => w.name.length > 0 && w.description.length > 0)).toBe(true);
    expect(weaponCatalog()).toBe(cat);
  });
});
