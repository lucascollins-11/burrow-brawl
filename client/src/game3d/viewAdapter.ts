import { TICKS_PER_SECOND, type MatchState } from "@burrow-brawl/shared";
import { yawToDeg } from "./cameraRig";
import type { ProjectileView, TeamView, ViewState } from "./viewState";

const FIXED_ONE = 65536;

/** The real match state as the renderer and HUD want it: floats in voxels, headings in degrees. */
export function viewFromMatch(
  state: MatchState,
  teams: readonly TeamView[],
  maxHp: number,
  myTurn: boolean,
): ViewState {
  const { sim, turns } = state;
  return {
    teams,
    critters: sim.critters.map((c) => ({
      id: c.id,
      team: c.team,
      name: `Mole ${c.id}`,
      x: c.pos.x / FIXED_ONE,
      y: c.pos.y / FIXED_ONE,
      z: c.pos.z / FIXED_ONE,
      headingDeg: yawToDeg(c.yaw),
      hp: c.hp,
      maxHp,
      alive: c.status === "alive",
    })),
    projectiles: sim.projectiles.map((p): ProjectileView => ({
      id: p.id,
      kind: p.weaponId === "fizz-grenade" ? "grenade" : "shell",
      x: p.pos.x / FIXED_ONE,
      y: p.pos.y / FIXED_ONE,
      z: p.pos.z / FIXED_ONE,
    })),
    activeCritterId: turns.activeCritter,
    activeTeam: turns.activeTeam,
    phase: turns.phase,
    round: turns.round,
    timeLeft: Math.max(0, turns.phaseEndTick - sim.tick) / TICKS_PER_SECOND,
    wind: { x: sim.windX, z: sim.windZ },
    seaY: sim.seaY,
    winnerTeam: turns.winnerTeam,
    myTurn: myTurn && turns.activeTeam !== null,
  };
}
