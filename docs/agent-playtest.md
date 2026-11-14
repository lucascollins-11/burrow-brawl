# Agent playtest harness

A way for a Claude session (or anyone with a Linux shell) to play the real Godot game, look at it,
and judge what needs work. It runs the game under a virtual display with a software renderer,
drives it with JSON steps, and writes a screenshot plus a state dump after every step.

Everything goes through the code a player uses: real key events for walking, jumping, aiming,
charging and skipping; the `Controls` node for aimed shots; the real HUD, pause menu, weapon grid,
title and how-to-play screens; and a real game server. Nothing is mocked.

Files: `godot/tests/playtest/playtest.gd` (the harness), `godot/tests/playtest/scenarios/*.json`
(ready-made runs), `tools/playtest/pt.sh` (setup and driver).

## Quick start (cloud session)

```
tools/playtest/pt.sh run godot/tests/playtest/scenarios/smoke.json /tmp/pt
```

The first run downloads Godot 4.4.1 to `~/godot-bin`, installs `xvfb` and the software Vulkan
driver (`mesa-vulkan-drivers`), imports the project, builds the server and starts it on
`127.0.0.1:8080`. That takes about two minutes. After that a run takes 30 to 90 seconds.

Then read `/tmp/pt/report.md` (one table row per step) and open the PNGs in `/tmp/pt/shots/` with
the Read tool. `/tmp/pt/steps.jsonl` has the full state for every step.

Ready-made scenarios:

| Scenario | What it does |
| --- | --- |
| `smoke.json` | Title screen, a 1v1 online match, walk, jump, aim, fire, the rival's turn, weapon and pause menus, skip. CI runs it headless on every PR. |
| `tutorial.json` | How-to-play pages, then the guided practice match with real key presses (Tab to aim, hold F to charge), the weapon menu, a jetpack, and auto-play turns. |
| `playthrough.json` | A full 1v1 match on Garden Patch where both sides fire acorns at each other until someone wins. |

## Step by step (interactive)

Keep the game running and send one step at a time. Each command prints the result, the key state
and the screenshot path.

```
tools/playtest/pt.sh start                                  # boots the game, waits until ready
tools/playtest/pt.sh do '{"do":"start","mode":"practice"}'
tools/playtest/pt.sh do '{"do":"walk","dir":"forward","seconds":1}'
tools/playtest/pt.sh do '{"do":"fire","weapon":"fizz-grenade","at":"nearest_enemy","fuse":2}'
tools/playtest/pt.sh do '{"do":"menu","open":"weapons"}'
tools/playtest/pt.sh stop                                   # quits and finishes report.md
```

The run's folder is `/tmp/burrow-playtest/current` (a link to the newest run). The game quits by
itself after 15 minutes without a step.

## Steps

Every step is a JSON object with `do`. Optional on every step: `"name"` (used in the screenshot
file name) and `"shot": false` (no screenshot).

| `do` | Fields | What happens |
| --- | --- | --- |
| `start` | `mode`: `match` (default) or `practice`; `theme` (`toybox-harbor`, `bathtub-bay`, `garden-patch`), `size`, `critters`, `seed`, `turn_seconds`, `opponent` | `match`: a second client joins as the rival, settings are set, both ready, the match starts. `practice`: the solo tutorial against dummies. Waits for the island to mesh and the first turn. |
| `screen` | `scene`: `title`, `howto`, `lobby`, `settings`; `page` (how-to-play page, 0 based) | Shows a menu screen over everything until the next step that needs the match. |
| `walk` | `dir`: `forward`, `back`, `left`, `right`; `seconds` | Holds the bound walk key. Directions are relative to the camera. |
| `key` | `action` (any id in `GameSettings.ACTIONS`: `jump`, `backflip`, `toggle_aim`, `fire`, `trigger`, `weapon_menu`, `fuse_up`...) ; `seconds` | Taps the bound key. |
| `hold` | `action`, `seconds` | Holds a key, for example `fire` to charge a shot for real. |
| `weapon` | `id` | Selects a weapon. The note gives its name and ammo left. |
| `aim` | like `fire` | Enters aim mode at the computed angle and power, without firing. |
| `fire` | `weapon`, `at` (`nearest_enemy`, `center`, a critter id, or `{"x":..,"z":..}`), or `yaw_deg`; `pitch`, `power`, `fuse`, `watch` (default true), `timeout` | Aims and fires through `Controls`, then (with `watch`) saves an in-flight screenshot and waits until the turn moves on. The note says how far from the target the blast landed. |
| `skip` | | Presses the skip key. |
| `wait` | `seconds` | Lets the game run. |
| `wait_for` | `until`: `my_turn`, `their_turn`, `control`, `turn_end`, `settled`, `over`; `timeout` | Waits for a game state. Fails on timeout. |
| `camera` | `dist`, `pitch`, `yaw`, `focus: "overview"` | Moves the orbit camera. |
| `menu` | `open`: `pause`, `settings`, `weapons`, `none` | Opens the pause menu, its settings page, or the weapon grid (with the real Q key); `none` closes them. |
| `opponent` | `policy`: `fire` (default), `skip`, `idle` | What the rival does on its turns in a `match`. |
| `play_turns` | `count`, `weapon` | Plays our next turns by firing at the nearest enemy; a screenshot after each. |
| `state` / `shot` | | Just records the state and a screenshot. |
| `quit` | | Ends the run. |

The aim helper uses the shot's launch speed and gravity from `shared/weapons/*.json` and ignores
wind, so the first shot is a guess. After each shot it corrects its power from where the blast
landed, so it usually hits within a few turns.

## What a step records

`steps.jsonl`, one line per step, and `last.json` for the newest:

- `ok`, `error`, `note` (what the step measured, such as "active critter moved 8.7 voxels" or
  "blast 12 voxels from the target (short)"), `ms`, `shot` (PNG path)
- `events`: server events since the last step (`fired`, `explosion`, `damage:<critter>:<amount>`,
  `crateDropped`, `jumped`, ...)
- `state`: `turn`, `round`, `phase`, `time_left`, `my_turn`, `active_critter`, `team_hp`, every
  critter (`id`, `team`, `hp`, `alive`, `pos`, `grounded`, and `act`/`shield`/`frozen`/`feather`
  when set), projectiles in the air, mines, crates, zones, `wind`, `weapon`, `ammo_left`, `aiming`,
  the HUD `banner` and `hint`, the `tutorial` prompt, which `menus` are open, the `camera`, and
  `winner_team`.

`report.md` is the table of steps. `pt.sh` appends the engine's own errors and warnings from
`godot.log` (audio-device noise is filtered out), because the game cannot see those itself.

## Options

| Env var | Default | Meaning |
| --- | --- | --- |
| `PT_SERVER` | local server on `http://127.0.0.1:8080` | Another server, for example `https://burrow-brawl.onrender.com` (not reachable from every sandbox). |
| `PT_HEADLESS=1` | off | No window and no screenshots. Much faster; good for checking logic. |
| `PT_TIMEOUT` | 900 | Seconds before a `run` is stopped. |
| `GODOT` | `godot` on PATH, else `~/godot-bin/godot` | The Godot 4.4.1 binary. |

Direct use without `pt.sh`:

```
xvfb-run -a -s "-screen 0 1280x720x24" godot --path godot --rendering-driver vulkan \
  --resolution 1280x720 res://tests/playtest/playtest.tscn -- --server=http://127.0.0.1:8080 \
  --scenario=/abs/path/scenario.json --out=/tmp/pt [--inbox=/tmp/pt/inbox.jsonl] [--stop-on-fail]
```

Exit code 0 means every step passed.

## Tips for reviewing the game

- Look at every screenshot, not only failures. Overlapping HUD text, cut-off menus and bad camera
  angles only show up in pictures.
- Compare `team_hp` before and after shots, and read `events` for `damage` to tell whether hits land.
- Run `smoke.json` headless first (`PT_HEADLESS=1`) to check logic in about 20 seconds, then
  with screenshots.
- Put new scenarios in `godot/tests/playtest/scenarios/` when they check something worth keeping.
- Example runs with screenshots are in the project files under `screens/playtest/`.
