// Bundles the server and everything it imports (shared, ws) into one file,
// so the runtime image needs only node and dist/index.js.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // ws optionally loads these native addons and falls back without them.
  external: ["bufferutil", "utf-8-validate"],
  // Bundled CommonJS deps (ws) call require(); give ESM output one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
