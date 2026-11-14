// Production-shape smoke test (O5).
//
// Builds the server bundle and the client the way Render and Vercel do, runs
// the bundle on its own (no workspace node_modules, NODE_ENV=production, a
// real ALLOWED_ORIGINS and JWT_SECRET), hosts client/dist statically on a
// different origin, then drives two browsers through the real UI: create,
// join by invite link, pick a hat, ready, start, one shot. Fails on any
// console error, page error or failed request, or if the turn doesn't pass.
//
//   node scripts/smoke/smoke.mjs            build, then run
//   node scripts/smoke/smoke.mjs --no-build reuse server/dist and client/dist
//   SMOKE_HEADED=1 ...                      watch it
//   SMOKE_CPU_THROTTLE=6 ...                emulate a slow machine

import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveStatic } from "./static.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT ?? 8787);
const CLIENT_PORT = Number(process.env.SMOKE_CLIENT_PORT ?? 4173);
const host = "127.0.0.1";
const serverUrl = `ws://${host}:${SERVER_PORT}`;
const httpBase = `http://${host}:${SERVER_PORT}`;
const clientOrigin = `http://${host}:${CLIENT_PORT}`;
const STEP_MS = 30_000;

const log = (...a) => console.log("[smoke]", ...a);
const cleanups = [];
/** Pages to describe if the run fails. */
const diag = [];

function sh(cmd, args, env = {}) {
  log("$", cmd, ...args);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

async function waitFor(fn, what, ms = STEP_MS) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ""}`);
}

function startServer() {
  // Like the Docker runtime stage: only server/package.json and server/dist, nothing else.
  const dir = mkdtempSync(join(tmpdir(), "bb-smoke-"));
  cpSync(join(root, "server/package.json"), join(dir, "server/package.json"));
  cpSync(join(root, "server/dist"), join(dir, "server/dist"), { recursive: true });
  const proc = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      HOST: host,
      PORT: String(SERVER_PORT),
      JWT_SECRET: randomBytes(48).toString("base64url"),
      ALLOWED_ORIGINS: clientOrigin,
    },
  });
  const out = [];
  const keep = (d) => {
    out.push(d.toString());
    process.stdout.write(`[server] ${d}`);
  };
  proc.stdout.on("data", keep);
  proc.stderr.on("data", keep);
  cleanups.push(() => {
    proc.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  });
  return { proc, out };
}

/** CORS and origin policy as a browser on another site would hit it. */
async function checkOrigins() {
  const guest = (origin) =>
    fetch(`${httpBase}/api/guest`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ nickname: "Probe" }),
    });
  const good = await guest(clientOrigin);
  if (good.status !== 200) throw new Error(`/api/guest from the client origin: ${good.status}`);
  if (good.headers.get("access-control-allow-origin") !== clientOrigin)
    throw new Error("/api/guest did not allow the client origin");
  const bad = await guest("https://evil.example");
  if (bad.status !== 403) throw new Error(`/api/guest from a foreign origin: ${bad.status}`);
  log("origin policy ok (client allowed, foreign origin refused)");
}

async function main() {
  if (!process.argv.includes("--no-build")) {
    sh("pnpm", ["--filter", "@burrow-brawl/server", "build"]);
    sh("pnpm", ["--filter", "@burrow-brawl/client", "build"], {
      VITE_GAME_SERVER_URL: serverUrl,
    });
  }

  const server = startServer();
  await waitFor(async () => (await fetch(`${httpBase}/healthz`)).ok, "server /healthz");
  const statics = await serveStatic(join(root, "client/dist"), CLIENT_PORT, host);
  cleanups.push(() => statics.close());
  log(`client on ${clientOrigin}, server on ${httpBase}`);
  await checkOrigins();

  const browser = await chromium.launch({
    headless: !process.env.SMOKE_HEADED,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  cleanups.push(() => browser.close());
  const problems = [];
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const throttle = Number(process.env.SMOKE_CPU_THROTTLE ?? 0);
    if (throttle > 1) {
      // Emulate a slow CI machine.
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    page.setDefaultTimeout(STEP_MS);
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`${name} console: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`${name} page error: ${e.message}`));
    page.on("requestfailed", (r) =>
      problems.push(`${name} request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`),
    );
    return page;
  };
  const alba = await open("alba");
  const bram = await open("bram");
  diag.push(["alba", alba], ["bram", bram]);

  // Title -> create room.
  await alba.goto(clientOrigin);
  await alba.getByPlaceholder("Your nickname").fill("Alba");
  await alba.getByRole("button", { name: "Create room" }).click();
  const code = (await alba.locator(".lobby .code").textContent())?.trim();
  if (!code || !/^[A-Z0-9]{5}$/.test(code)) throw new Error(`bad room code ${code}`);
  log("room", code);

  // Invite link -> join (exercises the /r/:code rewrite).
  await bram.goto(`${clientOrigin}/r/${code}`);
  await bram.getByPlaceholder("Your nickname").fill("Bram");
  const codeBox = bram.getByPlaceholder("ROOM CODE");
  if ((await codeBox.inputValue()) !== code) await codeBox.fill(code);
  await bram.getByRole("button", { name: "Join", exact: true }).click();
  await bram.locator(".lobby .code", { hasText: code }).waitFor();
  await alba.getByText("Players (2/4)").waitFor();

  // Teams: each player was seated on a free team; Bram also changes hat color.
  await bram.locator(".team.mine .swatch:not(.sel):not([disabled])").first().click();
  for (const p of [alba, bram]) await p.getByRole("button", { name: "I'm ready!" }).click();
  const start = alba.getByRole("button", { name: "Start match" });
  await waitFor(() => start.isEnabled(), "start button enabled");
  await start.click();

  // In the match: Alba (team 1) has the first turn.
  const turnText = (p) => p.locator(".bb-turn").textContent();
  await waitFor(async () => (await turnText(alba))?.includes("YOUR TURN"), "Alba's turn");
  await waitFor(async () => !(await turnText(bram))?.includes("YOUR TURN"), "Bram watching");
  log("match started, Alba to play");

  // One shot: acorn mortar. Holding F enters aim mode and charges; hold until the HUD shows
  // some power (slow CI machines render few frames), then release to fire.
  await alba.bringToFront(); // keep Alba's page foregrounded so its frames aren't throttled
  await alba.keyboard.press("1");
  await alba.keyboard.down("f");
  const power = async () =>
    Number(/Power (\d+)/.exec((await alba.locator(".bb-power").textContent()) ?? "")?.[1] ?? 0);
  await waitFor(async () => (await power()) >= 25, "the shot to charge");
  await alba.keyboard.up("f");
  // Firing ends control at once (retreat, then settling), long before the turn timer would.
  // A short shot can finish retreat and settling between two polls on a slow runner, so the
  // turn having already moved on also counts.
  await waitFor(
    async () => {
      const t = (await turnText(alba)) ?? "";
      return /run for cover|settle/.test(t) || (t !== "" && !t.includes("YOUR TURN"));
    },
    "the shot to end Alba's control",
    20_000,
  );

  // The turn passes to Bram on both screens.
  await waitFor(
    async () => (await turnText(bram))?.includes("YOUR TURN"),
    "Bram's turn after the shot",
    60_000,
  );
  await waitFor(async () => !(await turnText(alba))?.includes("YOUR TURN"), "Alba watching");
  log("shot fired and the turn passed on both clients");

  if (server.out.some((l) => /desync/i.test(l))) problems.push("server logged a desync");
  if (problems.length) throw new Error(`browser problems:\n  ${problems.join("\n  ")}`);
  log("PASS");
}

let code = 0;
try {
  await main();
} catch (e) {
  console.error("[smoke] FAIL", e);
  for (const [name, page] of diag) {
    try {
      const hud = await page.locator(".bb-turn, .bb-power").allTextContents();
      console.error(`[smoke] ${name} HUD: ${hud.join(" | ")}`);
    } catch {
      // page gone
    }
  }
  code = 1;
} finally {
  for (const f of cleanups.reverse()) {
    try {
      await f();
    } catch {
      // best effort
    }
  }
}
process.exit(code);
