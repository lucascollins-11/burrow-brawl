# Burrow Brawl

An original turn-based 2.5D artillery party game for a small group of friends.
You command teams of Molekins on destructible toy-diorama terrain, with wind, a turn timer, a silly arsenal and online play by room code.

- Plan: [docs/game-plan.md](docs/game-plan.md)
- Network protocol: [docs/protocol.md](docs/protocol.md)
- Terrain spec: [docs/terrain-spec.md](docs/terrain-spec.md)
- Weapon data: [shared/weapons/](shared/weapons/)

## Development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm lint          # ESLint
pnpm format:check  # Prettier (use `pnpm format` to fix)
pnpm typecheck     # tsc in every workspace package
pnpm test          # Vitest across shared, client and server
```

Workspaces: `shared/` (deterministic sim and shared types), `client/` (Vite + Three.js app), `server/` (WebSocket server).
