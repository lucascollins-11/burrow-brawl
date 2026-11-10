import { configFromEnv } from "./config";
import { createGameServer } from "./server";

export { createGameServer } from "./server";
export { configFromEnv, DEFAULTS } from "./config";

async function main(): Promise<void> {
  const config = configFromEnv();
  const server = createGameServer(config);
  const port = await server.listen();
  const origins = config.allowedOrigins.length
    ? config.allowedOrigins.join(", ")
    : "(same origin only)";
  console.log(`[server] listening on ${config.host}:${port}  ws: /ws  origins: ${origins}`);
  if (config.clientDir) console.log(`[server] serving client from ${config.clientDir}`);
  const stop = () => {
    console.log("[server] shutting down");
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// Run only when executed directly (tsx src/index.ts), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
