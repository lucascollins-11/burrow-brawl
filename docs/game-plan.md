# Burrow Brawl: game plan (working title)

An original, turn-based 2.5D artillery party game for a small group of friends.
Same genre as the classic worm-artillery games (destructible terrain, teams of
small critters, turn timer, wind, a silly arsenal), but with **its own name,
characters, art, sound, weapons and levels**. We do not copy any existing game's
names, characters, art, audio, maps or look.

## 1. Concept

- **Critters:** teams of 4 "Molekins": round, felt-and-clay looking moles with
  oversized hard hats, goggles and tiny tool belts. Each team picks a hat color
  and a hat style (miner, chef, pirate tricorn, traffic cone, etc.).
- **Setting:** a toy-box diorama look. Terrain is chunky, layered "cake" soil
  (crust, dirt, clay, bedrock that can't be destroyed) floating over a pit of
  bubbling soda. Falling in = out.
- **Art style:** low-poly, soft-shaded 3D models on a 2D play plane, warm pastel
  palette, thick outlines, paper-cutout background layers with parallax. Feels
  like a stop-motion toy set, not gritty or cartoon-realistic.
- **Tone:** goofy. Critters squeak short gibberish voice lines we record or
  synthesize ourselves.

## 2. Core rules (v1)

- 2 to 4 teams, 1 to 4 critters each, hot-seat or online.
- Turn order rotates by team, then by the team's next living critter.
- Turn timer: 45s (configurable), then 3s "retreat" after firing.
- Wind changes every turn, shown as an arrow and strength bar; affects
  projectiles flagged `windAffected`.
- Fall damage over a height threshold. Water/soda = instant knockout.
- Health 100 each. Team loses when all critters are out.
- Sudden death after N rounds: soda level rises each turn.
- Supply crates drop between turns (weapon or health).

## 3. Starting arsenal (original names)

| Weapon | Behavior |
|---|---|
| Acorn Mortar | Charged arc shot, wind affected, explodes on impact |
| Fizz Grenade | Thrown, bounces, fuse 1 to 5s |
| Pepper Shotgun | Two hitscan blasts per turn |
| Root Punch | Melee uppercut, big knockback |
| Spring Boots | Utility: one super jump |
| Rope Claw | Utility: grappling rope, swing and release |
| Drill Hat | Dig tunnel downward/sideways for 3s |
| Beehive Strike | Click target, 5 bombs fall from the sky |
| Jelly Mine | Placed, arms after 2s, triggers on proximity |
| Boulder of Doom | Slow rolling super-weapon, crate-only |
| Teleport Burrow | Move anywhere, ends turn |
| Skip Turn | Pass |

Weapons are data-driven (`weapons/*.json` + small behavior scripts) so adding
more is cheap.

## 4. Tech stack

- **Language:** TypeScript everywhere (shared types between client and server).
- **Client:** Vite + Three.js. Orthographic-ish camera on a 2D plane with 3D
  models; terrain rendered as an extruded mesh from the destruction mask.
- **Terrain:** 2D bitmap mask (e.g. 2048x1024 cells). Explosions carve circles.
  Mesh rebuilt per dirty chunk with marching squares. Collision reads the mask.
- **Physics:** our own small fixed-timestep (60Hz) deterministic sim in a
  `shared/` package: projectile ballistics, wind, bouncing, critter walking on
  the mask, knockback, fall damage. No floating random: seeded PRNG.
- **Networking:** authoritative Node server with WebSockets (`ws`), room codes
  for lobbies. Only the active player sends inputs; the server runs the sim and
  streams state/events; clients interpolate. Deterministic shared sim lets
  clients predict locally.
- **Accounts:** lightweight. Guest nickname by default; optional sign in
  (email magic link or Discord OAuth) to keep a profile, team cosmetics and
  stats. Session tokens as signed JWTs. SQLite (via Drizzle or Prisma) to
  start.
- **Audio:** Howler.js; original SFX made with jsfxr-style generators.
- **Tests:** Vitest for shared sim and server; Playwright smoke test for client.
- **Hosting:** single small server (Fly.io or Render) serving the client build
  and the WebSocket server. Friends join via a link + room code.

## 5. Repo layout (monorepo, pnpm workspaces)

```
/shared     sim, terrain mask, weapons data, rules, types, PRNG
/client     Vite + Three.js app, UI, input, rendering, audio
/server     ws server, rooms/lobby, auth, persistence
/assets     original models (glTF), textures, sfx, maps
/docs       this plan, protocol spec, style guide
```

## 6. Team and ownership

| Role | Model | Owns |
|---|---|---|
| Manager | Opus 5.5 (this thread) | Plan, specs, task breakdown, reviews, merges order |
| Systems engineer | Opus 5.5 | Accounts/auth, networking, server, determinism, nasty bugs |
| Feature builder | Sonnet 5.5 | Gameplay features from specs: terrain, physics, weapons, rendering, UI |
| Grunt work | Haiku 5.5 | Scaffolding, configs, lint/CI, data files, small fixes, docs, tests |

Rules for everyone: one branch and PR per task, PRs reviewed by the manager
before merge, shared types live in `/shared`, no copied names/art/sound from
any existing game.

## 7. Milestones and first tasks

**M0: Skeleton (week 1)**
- H1 (Haiku): Monorepo scaffold: pnpm workspaces, TS configs, ESLint + Prettier,
  Vitest, GitHub Actions CI (lint, typecheck, test), README.
- H2 (Haiku): `shared/weapons/*.json` for the 12 weapons above with a JSON schema.
- O1 (Opus systems): Server skeleton: `ws` server, room create/join by code,
  lobby state, heartbeat/reconnect. Write `docs/protocol.md` first.
- S1 (Sonnet): Client skeleton: Vite + Three.js scene, camera pan/zoom, debug HUD.

**M1: Local hot-seat playable (weeks 2 to 3)**
- S2: Terrain mask + marching-squares mesh + circular carving.
- S3: Deterministic sim loop: critter movement/jump on terrain, gravity, fall damage.
- S4: Projectiles + wind + explosions + knockback (Acorn Mortar, Fizz Grenade).
- S5: Turn manager, timer, team rotation, win condition, basic HUD.
- H3: Placeholder critter model + hat color variants; procedural map generator v1.
- O2: Seeded PRNG + determinism test harness (same inputs => same state hash).

**M2: Online with friends (weeks 3 to 4)**
- O3: Authoritative match on server, input relay, state snapshots, client interpolation.
- O4: Guest + optional sign-in, JWT sessions, SQLite profiles.
- S6: Lobby UI: create/join room, team setup, match settings.
- H4: Deploy config (Dockerfile + Fly.io), env docs.

**M3: Fun pass (weeks 5+)**
- Rest of the arsenal, crates, sudden death, sfx and voice lines, art polish,
  more maps, stats screen.
