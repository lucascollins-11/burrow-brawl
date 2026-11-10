interface ImportMetaEnv {
  /** WebSocket URL of the game server, e.g. wss://burrow-brawl.fly.dev. */
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
