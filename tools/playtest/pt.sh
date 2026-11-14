#!/usr/bin/env bash
# Agent playtest harness driver. See docs/agent-playtest.md.
#
#   tools/playtest/pt.sh run <scenario.json> [out_dir]   play a scenario, write a report, exit
#   tools/playtest/pt.sh start [scenario.json]           start the game and keep it running
#   tools/playtest/pt.sh do '<json step>'                do one step in the running game, print the result
#   tools/playtest/pt.sh stop                            quit the running game
#   tools/playtest/pt.sh setup                           only install Godot, Vulkan and the server
#
# Env: PT_SERVER (default: a local server started on 127.0.0.1:8080; set https://burrow-brawl.onrender.com
# for the live one), PT_HEADLESS=1 (no window, no screenshots, fast), PT_OUT (out dir for start),
# GODOT (path to a Godot 4.4.1 binary).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT_VERSION="4.4.1-stable"
GODOT="${GODOT:-$(command -v godot || echo "$HOME/godot-bin/godot")}"
SERVER="${PT_SERVER:-http://127.0.0.1:8080}"
STATE_DIR="${TMPDIR:-/tmp}/burrow-playtest"
mkdir -p "$STATE_DIR"

log() { echo "[pt] $*" >&2; }

setup_godot() {
  if [ ! -x "$GODOT" ]; then
    log "downloading Godot $GODOT_VERSION"
    mkdir -p "$HOME/godot-bin"
    curl -fsSL -o "$STATE_DIR/godot.zip" \
      "https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip"
    unzip -qo "$STATE_DIR/godot.zip" -d "$HOME/godot-bin"
    mv "$HOME/godot-bin/Godot_v${GODOT_VERSION}_linux.x86_64" "$HOME/godot-bin/godot"
    chmod +x "$HOME/godot-bin/godot"
    GODOT="$HOME/godot-bin/godot"
  fi
  if [ "${PT_HEADLESS:-0}" != "1" ]; then
    if ! command -v xvfb-run >/dev/null || [ ! -e /usr/share/vulkan/icd.d/lvp_icd.json ]; then
      log "installing xvfb and the software Vulkan driver (lavapipe)"
      SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
      $SUDO apt-get install -y -qq xvfb mesa-vulkan-drivers libvulkan1 >/dev/null 2>&1 || {
        $SUDO apt-get update -qq >/dev/null 2>&1
        $SUDO apt-get install -y -qq xvfb mesa-vulkan-drivers libvulkan1 >/dev/null
      }
    fi
  fi
  if [ ! -d "$ROOT/godot/.godot/imported" ]; then
    log "importing the Godot project"
    "$GODOT" --headless --path "$ROOT/godot" --import >/dev/null 2>&1 || true
  fi
}

setup_server() {
  [ -n "${PT_SERVER:-}" ] && return 0
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then return 0; fi
  log "building and starting the local game server"
  (cd "$ROOT" && { [ -d node_modules ] || pnpm install --frozen-lockfile >/dev/null; } && pnpm --filter @burrow-brawl/server build >/dev/null)
  (cd "$ROOT" && HOST=127.0.0.1 PORT=8080 HEARTBEAT_MS=60000 nohup node server/dist/index.js >"$STATE_DIR/server.log" 2>&1 &)
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "the server did not start; see $STATE_DIR/server.log"
  exit 1
}

godot_cmd() {
  if [ "${PT_HEADLESS:-0}" = "1" ]; then
    echo "$GODOT --headless --path $ROOT/godot"
  else
    echo "xvfb-run -a -s '-screen 0 1280x720x24' $GODOT --path $ROOT/godot --rendering-driver vulkan --resolution 1280x720"
  fi
}

abs_scenario() {
  case "$1" in
    res://*|/*) echo "$1" ;;
    *) echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" ;;
  esac
}

# Engine errors go into the report; the harness itself cannot see them.
append_errors() {
  python3 - "$1" <<'PY'
import re, sys
out = sys.argv[1]
lines = open(out + "/godot.log", errors="replace").read().splitlines()
noise = ("audio", "ALSA", "ObjectDB instances leaked", "resources still in use")
found = []
for i, line in enumerate(lines):
    if not re.match(r"^(ERROR:|WARNING:|SCRIPT ERROR|SHADER ERROR)", line):
        continue
    where = lines[i + 1].strip() if i + 1 < len(lines) else ""
    if any(n in line or n in where for n in noise):
        continue
    found.append("    " + line + ("\n        " + where if where.startswith("at:") else ""))
with open(out + "/report.md", "a") as f:
    f.write("\n## Engine errors and warnings\n\n")
    f.write("\n".join(found[:60]) + "\n" if found else "None.\n")
PY
}

cmd="${1:-}"
shift || true
case "$cmd" in
  setup)
    setup_godot; setup_server; log "ready" ;;
  run)
    [ $# -ge 1 ] || { echo "usage: pt.sh run <scenario.json> [out_dir]"; exit 2; }
    scen="$(abs_scenario "$1")"
    out="${2:-$STATE_DIR/run-$(date +%Y%m%d-%H%M%S)}"
    mkdir -p "$out"
    setup_godot; setup_server
    log "playing $scen -> $out"
    status=0
    eval timeout "${PT_TIMEOUT:-900}" "$(godot_cmd)" res://tests/playtest/playtest.tscn -- \
      --server="$SERVER" --scenario="$scen" --out="$out" >"$out/godot.log" 2>&1 || status=$?
    append_errors "$out"
    grep "^PLAYTEST" "$out/godot.log" || true
    log "report: $out/report.md"
    exit "$status" ;;
  start)
    out="${PT_OUT:-$STATE_DIR/live-$(date +%Y%m%d-%H%M%S)}"
    mkdir -p "$out"
    : >"$out/inbox.jsonl"
    setup_godot; setup_server
    scen_arg=""
    [ $# -ge 1 ] && scen_arg="--scenario=$(abs_scenario "$1")"
    eval nohup "$(godot_cmd)" res://tests/playtest/playtest.tscn -- --server="$SERVER" $scen_arg \
      --out="$out" --inbox="$out/inbox.jsonl" >"$out/godot.log" 2>&1 &
    echo "$!" >"$STATE_DIR/pid"
    ln -sfn "$out" "$STATE_DIR/current"
    for _ in $(seq 1 300); do
      [ -f "$out/ready" ] && { log "running; out dir $out"; exit 0; }
      kill -0 "$(cat "$STATE_DIR/pid")" 2>/dev/null || { tail -n 30 "$out/godot.log"; exit 1; }
      sleep 1
    done
    log "the game did not get ready in 300 s"; exit 1 ;;
  do)
    [ $# -ge 1 ] || { echo "usage: pt.sh do '<json step>'"; exit 2; }
    out="$STATE_DIR/current"
    [ -f "$out/inbox.jsonl" ] || { echo "nothing running; use pt.sh start"; exit 1; }
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert isinstance(d, dict) and "do" in d' "$1" 2>/dev/null \
      || { echo "not a JSON step object with a \"do\" key: $1"; exit 2; }
    before=$(wc -l <"$out/steps.jsonl" 2>/dev/null || echo 0)
    echo "$1" | tr -d '\n' >>"$out/inbox.jsonl"; echo >>"$out/inbox.jsonl"
    for _ in $(seq 1 "${PT_WAIT:-300}"); do
      now=$(wc -l <"$out/steps.jsonl" 2>/dev/null || echo 0)
      if [ "$now" -gt "$before" ]; then
        tail -n 1 "$out/steps.jsonl" | python3 -c '
import json, sys
r = json.loads(sys.stdin.read()); s = r["state"]
print(("OK" if r["ok"] else "FAIL"), r["do"], r["note"], r["error"])
keys = ["turn","phase","time_left","my_turn","active_critter","team_hp","weapon","ammo_left","banner","hint","tutorial","menus","winner_team"]
print(json.dumps({k: s[k] for k in keys if k in s}))
if r["events"]: print("events:", ", ".join(r["events"][:30]))
if r["shot"]: print("shot:", r["shot"])'
        exit 0
      fi
      kill -0 "$(cat "$STATE_DIR/pid")" 2>/dev/null || { echo "the game exited"; tail -n 20 "$out/godot.log"; exit 1; }
      sleep 1
    done
    echo "no result yet; check $out/steps.jsonl"; exit 1 ;;
  stop)
    out="$STATE_DIR/current"
    if [ -f "$out/inbox.jsonl" ]; then echo '{"do":"quit"}' >>"$out/inbox.jsonl"; fi
    for _ in $(seq 1 20); do kill -0 "$(cat "$STATE_DIR/pid" 2>/dev/null)" 2>/dev/null || break; sleep 1; done
    kill "$(cat "$STATE_DIR/pid" 2>/dev/null)" 2>/dev/null || true
    [ -f "$out/report.md" ] && append_errors "$(readlink -f "$out")" && log "report: $(readlink -f "$out")/report.md" ;;
  *)
    sed -n 2,13p "$0"; exit 2 ;;
esac
