# Burrow Brawl: network protocol (v0.1 draft)

Owner: systems engineer (O1). Status: draft for manager review.
Lives in the repo at `docs/protocol.md`; message types live in
`shared/src/net/protocol.ts` and are the source of truth once code exists.

## 1. Goals and model

- 2 to 4 teams, one player per team, so at most 4 connected clients per room.
  No spectators and no shared team control in v1.
  Friends on home connections, 30 to 200 ms RTT.
- **Server authoritative, deterministic lockstep for the active turn.**
  The server runs the shared sim (`/shared`, fixed 60 Hz, seeded PRNG, integer
  or fixed-point math only). Only the active player sends gameplay inputs. The
  server stamps each input with the tick it applies on and broadcasts it. Every
  client runs the same sim on the same inputs, so they stay in sync without
  streaming full world state each frame.
- **Snapshots are for safety, not for rendering:** full state on join and
  reconnect, and a state hash every 30 ticks so drift is detected and repaired
  (section 7).
- The active player predicts locally (applies its own input immediately) and
  reconciles if the server stamps it on a different tick.
- Turn-based pacing makes this forgiving: at most one critter is moving
  under player control at any time.

## 2. Transport

- One WebSocket per client at `<VITE_GAME_SERVER_URL>/ws`, e.g.
  `wss://brawl-server.fly.dev/ws`. The client is a static site on Vercel and
  the game server is a separate host, so this is cross-origin: the server
  accepts the WebSocket upgrade and `/api` CORS only from origins listed in
  `ALLOWED_ORIGINS` (plus its own origin when it serves the client itself in
  local dev or single-host mode). No WebRTC, no UDP in v1.
- Frames are JSON in v1 (`{ "t": "<type>", ...fields }`). All encoding and
  decoding goes through one codec module (`shared/src/net/codec.ts`,
  `encode(msg): string | Uint8Array`, `decode(frame): unknown`). Nothing else
  calls `JSON.parse`/`JSON.stringify` on wire data, so we can swap to a binary
  codec (e.g. msgpack) later without touching handlers.
- Every client to server message may carry `seq` (u32, per connection,
  incrementing). Replies that answer a request echo it as `re`: a request
  with `seq` gets exactly one `ok { re }` or `error { re }` (or, for
  `room.create`/`room.join`, `room.joined { re }`).
- Every message is validated on the server by `parseClientMessage` in
  `shared/src/net/protocol.ts` (dependency-free validators).
  Invalid message = `error { code: "bad_message" }`; 20 invalid messages in a
  minute = disconnect.
- Max frame 64 KB client to server, 4 MB server to client.
- `protocolVersion` (integer) is sent in `hello`. Mismatch = `error
  { code: "version_mismatch" }` and close, so friends know to refresh.

## 3. Identity and auth (summary, full spec in O4)

- **Guest:** client calls `POST /api/guest { nickname }` and gets a session
  token (signed JWT, HS256, 30 day expiry, `sub = guest_<ulid>`). Stored in
  localStorage. Nickname 2 to 16 chars, filtered.
- **Account (optional):** email magic link or Discord OAuth upgrades the guest
  to `sub = user_<ulid>`, keeping cosmetics and stats.
- The WebSocket authenticates with the first frame, not the URL (tokens
  shouldn't land in logs): `hello { token, protocolVersion, resumeToken? }`.
  No `hello` within 5 s = close 4001.
- One live connection per `sub` per room. A second connection takes over the
  seat and the old socket is closed with 4002 `replaced`.

## 4. Rooms and lobby

### 4.1 Room codes

- 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), about
  28 M codes. Case-insensitive on input. Join link: `https://<host>/r/K7QX2`.
- Rooms live in server memory. A room with nobody connected is deleted after
  10 minutes (lobby) or 5 minutes (match).
- Rate limits: 5 room creates per minute per IP, 20 join attempts per minute
  per IP (stops code guessing).

### 4.2 Room state

```ts
type RoomPhase = "lobby" | "loading" | "match" | "results";

interface RoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;              // sub of host; host migrates to next oldest member if host leaves
  members: Member[];
  teams: TeamSetup[];          // 2..4
  settings: MatchSettings;
  version: number;             // increments on every lobby change
}

interface Member {
  id: string;                  // sub
  nickname: string;
  teamId: string | null;       // null until they pick or create a team
  ready: boolean;
  connected: boolean;
  pingMs: number;
}

interface TeamSetup {
  id: string;
  name: string;
  hatColor: string;            // from fixed palette
  hatStyle: string;            // from cosmetics list
  critterNames: string[];      // 1..4
  controllerId: string | null; // the one member who plays this team (v1: one player per team)
}

interface MatchSettings {
  mapId: string | "random";
  mapSeed: number;
  turnSeconds: number;         // 15..90, default 45
  retreatSeconds: number;      // default 3
  crittersPerTeam: number;     // 1..4
  startHealth: number;         // default 100
  suddenDeathRound: number;    // 0 = off
  windMax: number;
  crateChance: number;         // 0..1
  arsenalPreset: string;
}
```

### 4.3 Lobby messages

Client to server:

| t | fields | who | notes |
|---|---|---|---|
| `hello` | `token, protocolVersion, resumeToken?` | any | must be first frame |
| `room.create` | | any | creator becomes host; nickname comes from the session token |
| `room.join` | `code` | any | `room_full` at 4 members, `match_in_progress` if not in lobby (unless resuming) |
| `room.leave` | | member | |
| `room.sync` | | member | server replies with `room.update` (full state) |
| `lobby.setTeam` | `teamId \| null` | member | claim a free team, or release yours; `team_taken` if it has a controller |
| `lobby.editTeam` | `teamId, patch` | team controller or host | name, hat, critter names |
| `lobby.addTeam` / `lobby.removeTeam` | `teamId?` | host | |
| `lobby.setSettings` | `patch` | host | |
| `lobby.ready` | `ready` | player | |
| `lobby.kick` | `memberId` | host | |
| `lobby.start` | | host | needs 2+ teams, every member on a team, everyone ready |
| `chat` | `text` (max 200) | member | rate limit 1/s |
| `ping` | `clientTime` | any | every 2 s |

Server to client:

| t | fields | notes |
|---|---|---|
| `welcome` | `you: {id, nickname}, serverTime, resumeToken, protocolVersion` | after a valid `hello` |
| `room.joined` | `room: RoomState` | full state on create/join |
| `room.update` | `room: RoomState` | full state after every change (it's small with 4 members); `room.sync` asks for one |
| `ok` | `re` | success reply to a request that carried `seq` |
| `room.left` | `reason` | `left`, `kicked`, `closed` |
| `chat` | `from, text, at` | |
| `pong` | `clientTime, serverTime` | RTT and clock offset |
| `error` | `code, message, re?` | see section 9 |

The server rejects lobby edits outside the `lobby` phase.
A new member is put on the first team with no controller, if any, so a
fresh room is playable without extra clicks. The room starts with 2 teams.

## 5. Match lifecycle

1. `lobby.start` → server sets phase `loading`, picks `matchSeed` (u32 from
   crypto RNG), builds the initial `MatchState` with the shared sim, and sends
   `match.start { matchId, seed, settings, teams, mapId, mapSeed, terrain,
   initialStateHash }`. `terrain` is the full initial mask (see section 7 for
   the terrain wire policy). Clients load the mask as sent rather than
   regenerating it, so a map generator change can't desync anyone.
2. Each client builds the world and replies `match.loaded { stateHash }`. A
   hash mismatch means a client build bug: that client gets a full `snapshot`.
3. When all players are loaded (or after 20 s), the server sends
   `turn.begin` and phase becomes `match`.
4. Turns run (section 6). The server alone decides turn ends, damage
   resolution, crate drops, sudden death and wind, using the shared sim and
   the match PRNG.
5. Win check after each turn settles: `match.end { winnerTeamId | null,
   stats }`, phase `results`. Host can `match.rematch` (back to lobby with the
   same teams) after that.

## 6. Turns and input relay

### 6.1 Ticks and clock

- Sim tick = 1/60 s. Server keeps `serverTick` per match.
- Clients estimate `serverTick` from `pong` (offset + RTT/2) and run their sim
  up to the latest tick they have inputs for. Non-active clients render
  `INTERP_DELAY = 6` ticks (100 ms) behind the newest confirmed tick so
  jitter doesn't cause stutter.

### 6.2 Turn begin

```
turn.begin {
  turn: number, round: number,
  teamId, critterId, controllerId,
  startTick, endTick,          // endTick = startTick + turnSeconds*60
  wind: number,                // already rolled by server PRNG
  stateHash
}
```

### 6.3 Input frames

Inputs are commands, not raw keys, so they're small and easy to validate.

```ts
type Cmd =
  | { k: "move"; dir: -1 | 0 | 1 }              // held state, sent on change
  | { k: "jump"; kind: "forward" | "back" }
  | { k: "aim"; angle: number }                 // fixed-point, 0..65535; sent at most every 3 ticks while changing
  | { k: "select"; weaponId: string }
  | { k: "fuse"; seconds: 1|2|3|4|5 }
  | { k: "chargeStart" }
  | { k: "fire"; power?: number }               // power 0..1000 if charged
  | { k: "target"; x: number; y: number }       // airstrike/teleport, map cells
  | { k: "rope"; action: "shoot" | "release" | "climb" | "swing"; v?: number }
  | { k: "skip" };
```

Client (active controller only) → server:

`input { turn, clientTick, cmds: Cmd[] }`, batched at most every 2 ticks,
only when there's something to send.

Server checks: sender is the controller of the active team, `turn` matches,
phase allows the command (no `fire` after firing, no weapon the team lacks),
values are in range. Rejected commands produce `error { code:
"input_rejected" }` and are dropped.

Server stamps accepted commands with `applyTick = max(serverTick + 1,
lastApplyTick)` (never in the past, never reordered) and broadcasts to
everyone including the sender:

`inputs { turn, applyTick, cmds: Cmd[] }`

### 6.4 Prediction on the active client

- The active client applies its own commands immediately at its local tick
  and keeps them in a pending buffer.
- When the echo arrives with `applyTick`, if it matches the predicted tick,
  drop it from the buffer. If not, roll back to the last confirmed state
  (clients keep a ring buffer of 120 tick states for the active turn) and
  re-simulate. With one controlled critter this is cheap.

### 6.5 Turn end

- The server ends control when the critter fires (start retreat), the timer
  hits `endTick`, the critter takes damage, or `skip`.
  `turn.control { phase: "retreat" | "none", untilTick }`.
- After control ends the world "settles": the sim runs until nothing is
  moving (or a 15 s cap). No inputs are accepted. Clients run the same sim
  forward with no inputs.
- Then the server sends `turn.settled { tick, stateHash, deaths, damage }`
  followed by the next `turn.begin` (with crates and sudden death applied by
  the server and included as `events`).

## 7. Hashes, snapshots and desync repair

### 7.1 Ownership

- The **terrain module** in `/shared` (S2) owns terrain serialization
  (`terrain.serialize()` / `Terrain.deserialize(bytes)`, RLE inside) and
  hashing (`terrain.hash()`, plus per-chunk checksums). The net layer never
  reads mask bytes directly.
- The **systems engineer** owns the wire policy below: when terrain goes over
  the wire and in what form.

### 7.2 Terrain wire policy

1. **Match start:** full serialized mask plus `mapSeed` in `match.start`.
2. **During the match:** terrain changes are never streamed as masks. They
   come from the sim itself (explosions, drill) as deterministic results of
   relayed inputs. The server also includes the turn's carve events in
   `turn.settled { carves: {x, y, r, tick}[] }` so clients can verify and
   late-applied effects are explicit.
3. **Hash mismatch** (state hash or terrain hash): full resync, meaning a
   `snapshot` with the full serialized mask.
4. **Join or reconnect mid-match:** full `snapshot`.

### 7.3 Hashes and snapshots

- Every 30 ticks the server broadcasts `hash { tick, h }` where `h` is a
  32-bit FNV-1a over the canonical serialized sim state (critter positions and
  velocities, health, projectiles, `terrain.hash()`, PRNG state).
- A client whose own hash for that tick differs sends `desync { tick, h }`
  and the server replies with a full `snapshot`. Desync reports are logged
  with the client build id; they are bugs to fix, not normal operation (O2
  owns the determinism test harness).
- `snapshot { tick, turn, state, terrain }`: `state` is the serialized
  `MatchState`; `terrain` is `terrain.serialize()` output (base64 in JSON
  v1). Sent on: reconnect, desync, failed load hash.
- The server keeps the last snapshot at each `turn.begin` plus all inputs
  since, so it can build a current snapshot quickly.

## 8. Heartbeat, disconnects and reconnect

- Client sends `ping` every 2 s; server answers `pong`. The server also uses
  WebSocket ping frames every 10 s. No traffic for 15 s = connection dead.
- On disconnect the member stays in the room with `connected: false`.
  `room.update` tells everyone.
- `welcome.resumeToken` is a short random token bound to `(sub, roomCode)`,
  valid 5 minutes after the disconnect. Reconnect = new socket, `hello { token,
  resumeToken }` → server sends `welcome`, `room.joined`, and if in a match a
  `snapshot` plus all `inputs` since that snapshot's tick, then the client is
  live again.
- Client reconnect backoff: 0.5 s, 1 s, 2 s, 4 s, then every 5 s, with jitter,
  for 5 minutes. UI shows "Reconnecting…".
- **Active player disconnects mid-turn:** no pause. The turn timer keeps
  running and the turn auto-ends at `endTick` as usual. If they reconnect
  before then, they get control back for the rest of the turn.
- **Disconnected player's later turns:** while their team's controller is
  disconnected, each of that team's turns is skipped immediately (`turn.begin`
  followed by an automatic `skip`). Their critters stay on the map and can
  still be hit. Turns resume normally once they reconnect. After the 5 minute
  resume window the seat is gone and the team keeps skipping until it's
  knocked out or the match ends.
- **Host disconnects:** host role moves to the oldest connected member. The
  match doesn't depend on the host, only on the server.
- **Server restart:** v1 rooms are in memory, so matches are lost. Clients
  show "Server restarted" and go back to the menu. Persisting matches is
  out of scope for v1.

## 9. Error codes

`bad_message`, `version_mismatch`, `unauthorized`, `room_not_found`,
`room_full`, `match_in_progress`, `team_taken`,
`not_host`, `not_in_room`, `not_allowed`, `not_your_turn`, `input_rejected`, `rate_limited`,
`name_invalid`, `internal`.

WebSocket close codes: 4001 no hello, 4002 replaced, 4003 kicked, 4004 room
closed, 4005 too many invalid messages, 4006 version mismatch, 4007
unauthorized (bad or expired token in `hello`).

## 10. Security notes

- Never trust the client for damage, turn ownership, crates or wind; the
  server computes all of it.
- Validate every field; clamp numbers; reject unknown `t`.
- Rate limit per connection (60 frames/s hard cap) and per IP for HTTP routes.
- Tokens only over TLS; JWT secret from env (`JWT_SECRET`), never committed.
- Nicknames and chat: length caps, strip control characters, render as text
  only (no HTML).

## 11. Server layout (for the O1 skeleton)

```
server/src/
  index.ts          http server (static client, /api/*), ws upgrade on /ws
  conn.ts           Connection: hello/auth, seq, rate limits, ping
  rooms/registry.ts code generation, create/join/lookup, idle cleanup
  rooms/room.ts     RoomState, lobby handlers, broadcast, host migration
  match/match.ts    owns shared sim instance, tick loop, input stamping, turn flow
  match/snapshot.ts build snapshots/state hash (calls terrain module for mask bytes and hash)
  auth/jwt.ts       sign/verify, guest route (full accounts in O4)
shared/src/net/
  protocol.ts       message types + validators + PROTOCOL_VERSION
  codec.ts          the only encode/decode of wire frames (JSON in v1)
```

O1 delivers: connection + hello, guest token, room create/join/leave by code,
lobby messages, ping/pong, reconnect with resumeToken, and Vitest tests that
run 2 to 4 fake clients against an in-process server. Match/turn messages are
stubbed until the shared sim (S3/O2) exists; O3 fills them in.

## 12. Decisions (manager, 2026-11-10)

1. JSON for v1, behind a single codec module so it can be swapped later.
2. No pause when the active player drops; the turn auto-ends and that team
   is skipped until they reconnect (section 8).
3. No spectators in v1.
4. One player per team in v1, no shared control.
5. Terrain module owns serialize/hash; systems owns the wire policy
   (section 7).
