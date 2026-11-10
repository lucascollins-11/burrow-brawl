// Minimal static host for client/dist, standing in for Vercel: serves files,
// rewrites /r/:code to index.html (vercel.json), and lives on its own origin.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export function serveStatic(dir, port, host = "127.0.0.1") {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (path === "/" || /^\/r\/[^/]+\/?$/.test(path)) path = "/index.html";
    const file = normalize(join(dir, path));
    let ok = file.startsWith(dir);
    try {
      ok = ok && statSync(file).isFile();
    } catch {
      ok = false;
    }
    if (!ok) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
