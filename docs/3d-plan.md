# Burrow Brawl 3D: plan (v2, 2026-11-10)

Lucas chose **true 3D gameplay in the browser**: critters move on a 3D island,
you aim in 3D with an orbit camera, and explosions carve 3D terrain. The game
stays original. Names, characters, art and maps are our own (Molekins,
toy-diorama look), and we copy nothing from any existing game. The game
supports up to **8 players**.

## What we keep (no rewrite)
- The monorepo, CI, the production smoke test and the deploy setup (Vercel + Render)
- The server: guest auth, rooms, codes, lobby, reconnect, rematch, watermark tick batches, snapshots, hash checks
- The client net layer (GameClient, NetMatch accumulator), lobby UI, results, waking screen, help and settings
- The turn controller, wind, PRNG, determinism harness, the weapon data registry and the weapon-case e2e table
- Audio, plus the FX concepts (particles, shake, popups), ported to 3D positions

## What we rebuild in 3D
1. **Terrain (shared/src/terrain3d).** A voxel density grid, 1 voxel = 0.5 world units (default
   256x96x256, 8-bit density), stored in 32^3 chunks with a per-chunk version. Carving is a
   sphere subtraction in integer math. Hash and serialize work per chunk (RLE).
   Bedrock layer, sea level for water. A map generator v2 builds islands from integer 3D value noise.
2. **Meshing (client).** Surface nets or marching cubes per dirty chunk, run in a Web Worker,
   with a triplanar toy-clay material. Only dirty chunks remesh after an explosion.
3. **Physics (shared/src/sim3d).** Q16.16 fixed-point vectors (x, y, z). Critters are
   capsules that walk on voxel ground with a slope limit, jump and backflip, and take fall
   damage. Projectiles do ballistics with wind on XZ, bounce off voxel normals, and fuse.
   No floats or trig: aim uses the yaw/pitch sine table.
4. **Camera and controls.** An orbit camera around the active critter. Mouse drag rotates,
   the wheel zooms, and WASD moves relative to the camera. An aim mode gives a first-person-ish
   view with yaw/pitch crosshairs and a power charge. The camera follows the projectile and then the blast.
5. **Weapons.** A full arsenal of 40 original weapons and utilities (see arsenal.md), built on ~12 shared behavior
   primitives. Each one gets a weapon-case row in the online determinism table.
6. **Rendering.** 3D Molekin models (procedural to start, Blender glTF later), a skybox and diorama
   backdrop, a water plane, shadows, and 8 team colors.

## 8 players
- Room cap of 8, one player per team, 8 team colors and hats
- 1-4 critters per team. The default is 2 when there are 5+ teams. Map size scales with team count.
- Spawn search is tested for 8x4 = 32 distinct, grounded spawns
- HUD: compact team bars plus a turn-order strip. An optional shorter turn timer for 6+ players.
- E2E: an 8-client hash test

## Performance budget
- 60 fps on a mid laptop with 8 teams x 2 critters
- Remeshing one 32^3 chunk in a worker takes < 8 ms
- The full voxel hash is cached per chunk version

## Milestones
- **3D-M1, local sandbox:** voxel terrain + carving + meshing, one critter walking, orbit camera
- **3D-M2, hot-seat:** projectiles, the two starter weapons, turns, HUD on 3D, 8-team local play
- **3D-M3, online:** sim3d plugged into match/net, hash e2e and smoke test green, deploy
- **3D-M4a, arsenal wave 2:** 12 more weapons + supply crates
- **3D-M4b, arsenal wave 3 + polish:** the rest of the 40, balance, art polish

- **3D-M5, content complete:** all modes, 8 maps, challenges, unlocks (see content.md)

Rough timeline: 3D-M1 to M3 take about 2-3 sessions. Arsenal and content (M4a to M5) take about 3-4 more.

## Team (same as session 1)
- Opus systems: sim3d fixed-point physics core + match/net integration + determinism tests
- Sonnet A: terrain3d + meshing worker + map gen v2
- Sonnet B: camera/controls/aim UI, 3D rendering and models, HUD for 8 players
- Haiku: 8-player lobby/server cap and colors, docs, small ports, reviews of Sonnet PRs
- Fable: architecture review of terrain3d and sim3d before merge

The open 2.5D PRs (#21, #24, #25, #27, #28): #21 (help/settings) and #25 (local play) are
kept as-is, since they don't depend on 2D or 3D. #24, #27 and #28 are closed. Their weapon
logic is the reference for the 3D ports.

## Gameplay feel (Lucas, 2026-11-10)
The target is to match the core feel of classic 3D turn-based artillery games, while staying our own game.

**Genre core we match closely**
- Teams take turns, one critter per turn, cycling through each team's critters
- A turn timer (default 45s, configurable) and a short retreat timer after attacking
- Wind every turn, shown on the HUD, affecting lighter projectiles
- Fall damage, instant knockout in the water, damage numbers, health shown above each critter
- A free orbit camera to survey the island, plus a dedicated aim view with a power charge
- A full-screen weapon menu grid grouped by category, with ammo counts and crate-only items
- Supply crates (weapons, health, utility) dropping between turns
- Sudden death after N rounds: the sea rises each turn
- A match setup with teams, critters per team, turn time, starting health, a weapon set and a map seed
- Pacing: short punchy turns, the camera following shots and blasts, and the end of a turn waiting until everything settles

**What we don't copy**
- No game modes, maps, characters, names, voice lines, menus or signature weapons copied one for one
- No look-alike art or UI layout. We use our own toy-diorama style and HUD.

**Our own twists**
- Toy-box islands floating on a fizzy soda sea, with destructible "clay" voxel terrain
- Build Block and Toy Block Drop leave new terrain behind, so players reshape the map
- Status weapons (Snow Globe freeze, Glue Puddle, Hot Sauce fire zones) for tactical play
- Hat perks: each team picks a hat with a small cosmetic-plus-minor perk (e.g. +10% jump),
  off by default and toggled in match settings
- Wind is visible in the world as paper streamers and lantern drift, not just on the HUD
- Party-sized: up to 8 players, one link to join
