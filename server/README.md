# @burrow-brawl/server

Authoritative game server: HTTP API, WebSocket rooms and lobby, and (for local
dev or single-host mode) the built client as static files. One Node process, no
external services. Rooms live in memory. Protocol: [docs/protocol.md](../docs/protocol.md).

```sh
pnpm --filter @burrow-brawl/server dev     # watch mode on :8080
pnpm --filter @burrow-brawl/server start
pnpm test                                  # from the repo root
```

## Endpoints

| Path | What |
|---|---|
| `POST /api/guest` `{ nickname }` | Guest session token (HS256 JWT, 30 days) |
| `GET /healthz` | `{ ok, rooms, connections }` |
| `GET /ws` (upgrade) | Game WebSocket; first frame must be `hello` |
| everything else | Static client from `CLIENT_DIR` with SPA fallback (`/r/CODE`), if set |

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `JWT_SECRET` | random in dev | Required in production, at least 32 bytes |
| `ALLOWED_ORIGINS` | empty | Comma list of browser origins allowed on `/ws` and `/api`, e.g. the Vercel URL. Same origin is always allowed. `*` allowed only outside production |
| `CLIENT_DIR` | unset | Path to `client/dist` to serve the client from this server |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for client IPs (set on Fly/Render) |
| `NODE_ENV` | | `production` turns on the strict checks above |

The client points at this server with `VITE_GAME_SERVER_URL` (for example
`wss://brawl-server.fly.dev`); the server must list the client's origin in
`ALLOWED_ORIGINS`.

## Layout

```
src/
  index.ts          entry point (env config, listen, graceful shutdown)
  server.ts         wires HTTP, WebSocket upgrade + origin check, heartbeat, sweeper
  http.ts           /api/guest, /healthz, CORS, static client
  conn.ts           one socket: hello/auth, rate limits, dispatch, resume
  rooms/registry.ts room codes, membership, resume tokens, cleanup
  rooms/room.ts     room + lobby state and rules, broadcast, host migration
  auth/jwt.ts       HS256 sign/verify
  rateLimit.ts      fixed-window limiter
  testing/harness.ts in-process server + scripted clients for tests
```

Wire types, validation and the codec live in `shared/src/net`.
