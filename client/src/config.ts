/** Game server URL. Set VITE_GAME_SERVER_URL in the Vercel project (or a local .env). */
export const GAME_SERVER_URL: string =
  import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:8080";
