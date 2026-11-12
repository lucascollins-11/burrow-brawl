# Burrow Brawl (Godot client)

The Godot 4 game client. The Node game server (`server/`) stays the referee: it runs the rules and
physics, and this client draws the world, plays sound, shows menus, and sends the player's input.
See `docs/view-protocol.md` for the match contract and `docs/protocol.md` for the lobby.

## Play it on Windows (for playtesting)

1. On the project's GitHub page, open **Releases** and pick the `godot-pr-<number>` release for the build you were given.
2. Download `BurrowBrawl-windows.zip`, right-click it, and choose **Extract All**.
3. Open the folder and double-click `BurrowBrawl.exe`. If Windows warns about an unknown app, click **More info**, then **Run anyway**.
4. Type a nickname and click **Create room**, or type a room code and click **Join by code**. New to the game? Click **How to play** on the title screen first.

The game opens in its own window; the release build has no console. Logs are in `%APPDATA%\Godot\app_userdata\Burrow Brawl\logs`. Steps for reporting problems are in [docs/playtest.md](../docs/playtest.md).

## Pinned version

**Godot 4.4.1-stable** (Forward+, GDScript only). Use exactly this version. The CI workflow in
`.github/workflows/godot.yml` uses the same value in its `GODOT_VERSION` variable. Change both
together, in one PR.

## Run it

1. Download Godot 4.4.1-stable from <https://godotengine.org/download/archive/4.4.1-stable/>.
2. Open `godot/project.godot` in the editor, or run the project from the command line:

   ```
   godot --path godot
   ```

   To point at another server (for example a local one on port 8080):

   ```
   godot --path godot -- --server=http://localhost:8080
   ```

3. On the title screen, pick a nickname and either create a room or join one by its code.

## Test it headless

```
godot --headless --path godot --import
godot --headless --path godot -s res://tests/run_tests.gd
```

The runner exits with 0 when every test passes. Test suites live in `godot/tests/`, one file per
area, each extending `TestCase` with `test_*` methods.

## Export a Windows build

```
godot --headless --path godot --export-release "Windows Desktop" ../build/BurrowBrawl.exe
```

This needs the 4.4.1-stable export templates installed. CI installs them for you. The preset is in
`godot/export_presets.cfg`, and it embeds the game data into one `.exe`.

## CI

`.github/workflows/godot.yml` runs on every pull request:

- **test**: imports the project and runs the headless tests.
- **export-windows**: exports `BurrowBrawl-windows.zip`, uploads it as a workflow artifact, and
  attaches it to a GitHub Release named `godot-pr-<number>` (a pre-release, replaced on each push).
  Pull requests from forks get the artifact only, because their token cannot write releases.

Nobody can run Godot inside the agent workspaces yet, so CI is the build and test loop.

## Layout

```
project.godot          engine settings and the Net autoload
export_presets.cfg     Windows export preset
net/                   Net autoload (WebSocket, guest login, room state), protocol helpers, lobby state, server URLs
ui/                    title, lobby and how-to-play screens (built in code on top of small .tscn shells)
tests/                 headless GDScript tests
```

Rules: GDScript only, no C#. Scenes and resources are text (`.tscn`, `.tres`), so they can be read
and reviewed in diffs.

## Status

G0 (skeleton and pipeline): the lobby works against the live server. The match view comes next
(G1), and it uses the view protocol.
