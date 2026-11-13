# View protocol

Contract between the game server and a **view client**: a client that draws the match but does
not simulate it. The Godot client is a view client. Owner: the architect. Changes to this file and
to `shared/src/net/view.ts` go through the architect.

The server is the only referee. It runs `sim3d` and `terrain3d` and tells view clients what the
world looks like. A view client never computes physics, damage or terrain edits, so it cannot
drift from the server and needs no hashes or resync logic.

Everything in `docs/protocol.md` about transport, sessions, rooms, the lobby, chat, ping and errors
applies unchanged. Only the match messages differ.

## 1. Becoming a view client

`hello` gains one optional field:

```
{ t: "hello", token, protocolVersion, resumeToken?, view?: true }
```

With `view: true` the connection receives the messages in this document instead of `tick`
batches and `snapshot`. Lockstep clients (the three.js client) and view clients can share a room.
`desync` from a view client is ignored.

## 2. Units

- Positions are the sim's integers: Q16.16 voxels, +y up. Divide by 65536 for world units.
  One voxel is one Godot unit.
- Headings are sim yaw: 0..1023, 0 = +x, 256 = +z. Pitch is whole degrees, positive up.
- `tick` is the sim tick (60 per second).

## 3. Server to view client

### `match.start`

Sent when the match starts and again whenever the client (re)connects during a match. It is always
complete: a client that receives it throws away what it had.

```
{
  t: "match.start",
  view: true,
  matchId: string,
  config: MatchConfig,          // turn lengths, start health, team sizes, wind max
  teamIds: string[],            // room team id for each sim team index
  terrain: {
    sizeX: number, sizeY: number, sizeZ: number,
    seaY: number, bedrockY: number,
    density: string             // section 5
  },
  state: ViewState,             // full: every critter
  weapons: WeaponInfo[]         // the weapon menu, then sub-munitions (see below)
}
WeaponInfo = {
  id, name, description,        // our own names and text, from shared/weapons/*.json
  needs: ("target" | "trigger" | "fuse" | "charge")[],
  ammo: number | null,          // per team per match; null = unlimited
  fireable: boolean             // false for sub-munitions (seeds, bombs): name and draw only
}
```

`needs` says what the client collects for `fire`: `target` a voxel picked on the map
(`fire.target`), `fuse` 1..5 seconds (`fire.fuseSeconds`), `charge` a power held on the fire key
(`fire.power`); `trigger` means the shot can be popped in flight by sending `{ k: "trigger" }`.
Clients build the weapon menu from this list and never hardcode it. Projectiles and events may
name any id in the list, sub-munitions included.

### `state`

Sent every 3 ticks (20 per second) while the match runs.

```
ViewState = {
  tick: number,
  turns: TurnState,             // turn, round, phase, activeTeam, activeCritter, phaseEndTick, winnerTeam, windX, windZ
  seaY: number,                 // rises in sudden death
  critters: ViewCritter[],      // only critters that changed since the previous state message
  projectiles: ViewProjectile[] // always the full list; a missing id is gone; placed mines are not here
  mines?: ViewMine[]            // placed Jelly Mines: always the full list; a missing id went off or sank
  ammo?: Record<string, number>[] // per sim team: shots left by weapon id, limited weapons only;
                                // a weapon not listed is unlimited; always complete
  crates?: Crate[]              // {id, kind: "health"|"weapon", weaponId, x, y, z} in voxels;
                                // always the full list; a missing id was taken or sank
}
ViewCritter    = { id, team, x, y, z, yaw, hp, status: "alive" | "dead" | "drowned", grounded: boolean,
                   act?: "drill" | "boots" | "jetpack" | "umbrella",  // busy with a utility; absent = nothing
                   fuel?: number }   // Soda Jetpack bursts left, only with act "jetpack"
ViewProjectile = { id, ownerId, weaponId, x, y, z, fuseTicks }
ViewMine       = { id, ownerId, weaponId, x, y, z,
                   armed: boolean,      // past its arming delay: a critter close by now sets it off
                   triggered: boolean,  // set off; explodes in fuseTicks ticks
                   fuseTicks }          // -1 while it lies in wait
```

`{ t: "state", ...ViewState }` on the wire. A client keeps the last two states and draws
between them (about 50 ms behind the server). Seconds left on the timer are
`max(0, turns.phaseEndTick - tick) / 60`.

### `events`

```
{ t: "events", tick: number, events: SimEvent[] }
```

The sim's events in order, sent in the same 3-tick batch as the `state` that covers them and
before it: `jumped`, `landed`, `damage`, `died`, `fired`, `tracer`, `bounced`, `explosion`,
`projectileLost`, and the crate events `crateDropped`, `crateTaken` `{crateId, critterId, kind,
weaponId, amount}` and `crateLost`. A hitscan weapon (the Pepper Shotgun) sends `fired` with `projectileId: -1`, then
one `tracer` `{critterId, weaponId, from, to, hit}` per pellet (`from` and `to` are Q16.16 voxel
points) and an `explosion` for each pellet that hit. The Root Punch sends `fired`, then `punch` `{critterId, at, hits}` and a `damage` per critter struck. The Teleport Burrow sends `fired`, then `teleported` `{critterId, from, to}`; a burrow with no clear spot at its target sends nothing and costs nothing. A Jelly Mine is listed in `mines`, not `projectiles`, from the tick it is dropped until it goes off or sinks; it lies in wait with `fuseTicks: -1` and does not hold up the turn. `mineTriggered` `{projectileId}` is sent when a critter sets it off. The Drill Hat sends `fired` (`projectileId: -1`) and does not end the turn; the critter then shows `act: "drill"` while it tunnels and the tunnel arrives as ordinary `terrain.patch`es. Spring Boots, the Soda Jetpack and the Umbrella Glide also send `fired` (`projectileId: -1`) and do not end the turn; while worn the critter shows `act` "boots", "jetpack" (with `fuel`, the bursts left; each `jump` in the air spends one) or "umbrella", until it lands. A soft landing still sends `landed`, with `fallDistance` 0 when nothing was felt. They drive sound, effects and damage numbers. They never change what the client
believes about positions, health or terrain; `state` and `terrain.patch` do that.

### `terrain.patch`

```
{ t: "terrain.patch", tick: number, x0, y0, z0, sx, sy, sz, density: string }
```

Sent after every terrain edit, before the `state` for that batch. It carries the new bytes of the
box `[x0, x0+sx) x [y0, y0+sy) x [z0, z0+sz)`, encoded as in section 5. The client overwrites
those voxels and remeshes the chunks the box touches plus their neighbours (a chunk mesh reads a
1-voxel border).

### `match.end`

Unchanged: `{ t: "match.end", winnerTeamId, tick, reason? }`.

## 4. View client to server

Unchanged: `{ t: "input", turn, cmds }` with the commands in `shared/src/match/match.ts`:

```
{ k: "move", yaw }              // 0..1023, or -1 to stop; held until changed
{ k: "jump" } { k: "backflip" } { k: "skip" }
{ k: "trigger" }                // pop your shot in flight (weapons whose needs include "trigger")
{ k: "fire", weaponId, yaw, pitch, power, fuseSeconds?, target? }
```

The client turns camera-relative keys into an absolute heading before sending. Send `move` only
when the heading changes. The server answers `not_your_turn` or `input_rejected` as today.

## 5. Voxel encoding

Voxels are one byte each (density 0..255, solid at 128 or more). Order is x fastest, then z, then
y: `index = (y * sizeZ + z) * sizeX + x` for the whole grid, and the same nesting inside a patch
box (`((y - y0) * sz + (z - z0)) * sx + (x - x0)`).

The bytes are run-length encoded as pairs `[count - 1, value]` (so one pair covers 1 to 256 equal
bytes), and the result is base64 (standard alphabet, with padding). Decoding: read pairs, write
`value` `count` times, stop at the end; the total must equal the box volume or the message is
invalid.

Outside the grid: below y = 0 is solid, everything else is air.

## 6. What a view client does not need

Map generation, the sim, hashes, snapshots, the edit log. If a view client thinks it needs one of
these, the protocol is missing something: ask the architect.
