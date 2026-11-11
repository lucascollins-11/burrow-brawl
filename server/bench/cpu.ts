// Server CPU benchmark: an 8-team match with blasts, over real sockets, with 8 view clients
// (what the Godot client is). Run with `pnpm --filter @burrow-brawl/server bench`.
//
// It measures, on this machine's single core:
//   1. match start: world generation, the view match.start (terrain encode + JSON), and the
//      wall time until all 8 sockets have it;
//   2. blast turns: ms per 3-tick batch, split into sim steps and the send (view batch,
//      patches, JSON, 8 ws.send calls);
//   3. idle cost of the realtime 60 Hz loop (4 ms timer) with nobody acting;
// then scales the per-second CPU need against a 0.1 CPU quota (Render free).

import { performance } from "node:perf_hooks";
import { MATCH_TURNS, stepMatch, type MatchState } from "@burrow-brawl/shared";
import { encode } from "@burrow-brawl/shared/src/net";
import { MatchRunner, type MatchHost } from "../src/match/runner";
import { startHarness, type TestClient } from "../src/testing/harness";
import { yawTowardCenter } from "../src/testing/players";
import { connectView } from "../src/testing/viewPlayer";

const TEAMS = 8;
const CRITTERS = 4;
const SEED = 7;
const BLAST_TURNS = Number(process.env.BLAST_TURNS ?? 6);
const QUOTA = 0.1; // Render free: 0.1 CPU

const ms = (n: number) => `${n.toFixed(2)} ms`;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { n: s.length, mean, p50: q(0.5), p99: q(0.99), max: s.at(-1) ?? 0 };
};
const row = (name: string, xs: number[]) => {
  const s = stats(xs);
  console.log(
    `  ${name.padEnd(26)} n=${String(s.n).padStart(5)}  mean ${ms(s.mean)}  p50 ${ms(s.p50)}  p99 ${ms(s.p99)}  max ${ms(s.max)}`,
  );
  return s;
};
const cpuMs = (u: NodeJS.CpuUsage) => (u.user + u.system) / 1000;

function settingsFor() {
  return {
    turnSeconds: 45,
    retreatSeconds: 3,
    crittersPerTeam: CRITTERS,
    startHealth: 100,
    mapSeed: SEED,
    windMax: 50,
  };
}

/** A host that serialises each message once (like conn.ts's frame cache) and drops it. */
function sinkHost(): MatchHost & { bytes: number } {
  const h = {
    bytes: 0,
    broadcast: (m: object) => void (h.bytes += encode(m).length),
    broadcastTo: (_k: string, m: object) => void (h.bytes += encode(m).length),
    sendTo: () => {},
    isConnected: () => true,
    isView: () => true,
    onEnd: () => {},
  };
  return h;
}

async function main(): Promise<void> {
  console.log(`node ${process.version}, ${TEAMS} teams x ${CRITTERS} critters, seed ${SEED}\n`);

  // ---------------------------------------------------------------- 1. match start, in process
  console.log("1. match start (in process, no sockets)");
  const gen: number[] = [];
  const viewStart: number[] = [];
  const lockStart: number[] = [];
  let startBytes = 0;
  for (let i = 0; i < 5; i++) {
    const config = MatchRunner.configFor(settingsFor(), TEAMS);
    let t0 = performance.now();
    const r = new MatchRunner(
      config,
      [...Array(TEAMS).keys()].map(String),
      [...Array(TEAMS).keys()].map((k) => `m${k}`),
      sinkHost(),
      { ticker: "manual" },
    );
    gen.push(performance.now() - t0);
    t0 = performance.now();
    const vs = encode(r.viewStartMessage());
    viewStart.push(performance.now() - t0);
    startBytes = vs.length;
    t0 = performance.now();
    encode(r.startMessage());
    lockStart.push(performance.now() - t0);
  }
  const genS = row("generate world", gen);
  const vsS = row("view match.start + JSON", viewStart);
  row("lockstep match.start", lockStart);
  console.log(`  view match.start is ${(startBytes / 1e6).toFixed(2)} MB\n`);

  // ---------------------------------------------------------------- 2. real sockets
  console.log(`2. real sockets: ${TEAMS} view clients, ${BLAST_TURNS} blast turns`);
  const h = await startHarness();
  const clients: TestClient[] = [];
  const bytesIn = new Map<TestClient, number>();
  for (let i = 0; i < TEAMS; i++) {
    const c = await connectView(h, `P${i}`);
    bytesIn.set(c, 0);
    c.ws.on("message", (d: Buffer) => bytesIn.set(c, bytesIn.get(c)! + d.length));
    clients.push(c);
  }
  const host = clients[0]!;
  host.send({ t: "room.create" });
  const { code } = await host.room();
  for (const c of clients.slice(1)) {
    c.send({ t: "room.join", code });
    await c.next("room.joined");
  }
  for (let i = 0; i < TEAMS - 2; i++) await host.request({ t: "lobby.addTeam" });
  const room = await host.room((s) => s.teams.length === TEAMS && s.members.length === TEAMS);
  for (let i = 0; i < TEAMS; i++)
    await clients[i]!.request({ t: "lobby.setTeam", teamId: room.teams[i]!.id });
  await host.request({ t: "lobby.setSettings", patch: settingsFor() });
  for (const c of clients) c.send({ t: "lobby.ready", ready: true });
  await host.room((s) => s.members.every((m) => m.ready));

  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  host.send({ t: "lobby.start" });
  await Promise.all(clients.map((c) => c.next("match.start", 10_000)));
  const startWall = performance.now() - t0;
  const startCpu = cpuMs(process.cpuUsage(cpu0));
  console.log(
    `  lobby.start -> all ${TEAMS} have match.start: ${ms(startWall)} wall, ${ms(startCpu)} CPU (server + 8 clients decoding)`,
  );

  const runner = h.server.registry.get(code)!.match!;
  const controllers = (runner as unknown as { controllers: string[] }).controllers;
  const byId = new Map(clients.map((c) => [c.id, c]));

  // Time each sim step separately from the whole batch (step + send).
  const steps: number[] = [];
  const opts = (runner as unknown as { opts: { step?: typeof stepMatch } }).opts;
  opts.step = (c, s, cmds) => {
    const a = performance.now();
    const r = stepMatch(c, s, cmds);
    steps.push(performance.now() - a);
    return r;
  };

  const batchIdle: number[] = [];
  const batchBlast: number[] = [];
  const stepBlast: number[] = [];
  const sendBlast: number[] = [];
  let blasts = 0;
  let edits0 = runner.matchState.sim.terrain.edits.length;
  const drain = () => {
    for (const c of clients) (c.peek() as unknown[]).length = 0;
  };
  const batch = (into: number[], blast: boolean) => {
    const n0 = steps.length;
    const a = performance.now();
    runner.advance(3);
    const total = performance.now() - a;
    into.push(total);
    if (blast) {
      const st = steps.slice(n0).reduce((x, y) => x + y, 0);
      stepBlast.push(st);
      sendBlast.push(total - st);
    }
  };
  const flushIo = () => new Promise<void>((res) => setImmediate(res));

  // Spawns land (warm-up, not counted), then idle batches during the first turn's control phase.
  for (let i = 0; i < 210; i++) {
    batch(i < 10 ? [] : batchIdle, false);
    await flushIo();
    drain();
  }

  const bytesBefore = [...bytesIn.values()].reduce((a, b) => a + b, 0);
  const ticksBefore = runner.tick;
  for (let k = 0; k < BLAST_TURNS && runner.matchState.turns.phase !== "over"; k++) {
    const st: MatchState = runner.matchState;
    const team = MATCH_TURNS.activeTeam(st.turns);
    if (team === null) {
      batch(batchIdle, false);
      k--;
      continue;
    }
    const turn = st.turns.turn;
    const shooter = byId.get(controllers[team]!)!;
    const grenade = k % 2 === 1;
    const fire = grenade
      ? {
          k: "fire" as const,
          weaponId: "fizz-grenade" as const,
          yaw: yawTowardCenter(st),
          pitch: 50,
          power: 40,
          fuseSeconds: 2,
        }
      : {
          k: "fire" as const,
          weaponId: "acorn-mortar" as const,
          yaw: yawTowardCenter(st),
          pitch: 55,
          power: 35,
        };
    const res = await shooter.request({ t: "input", turn, cmds: [fire] });
    if (res.t !== "ok") throw new Error(`fire rejected: ${JSON.stringify(res)}`);
    for (let i = 0; i < 2000 && runner.turn === turn; i++) {
      batch(batchBlast, true);
      await flushIo();
      drain();
    }
    const edits = runner.matchState.sim.terrain.edits.length;
    blasts += edits - edits0;
    edits0 = edits;
  }
  const blastTicks = runner.tick - ticksBefore;
  const bytesBlast = [...bytesIn.values()].reduce((a, b) => a + b, 0) - bytesBefore;

  console.log(`  ${blasts} terrain edits over ${blastTicks} ticks of blast turns`);
  const idleS = row("idle batch (3 ticks)", batchIdle);
  const blastS = row("blast batch (3 ticks)", batchBlast);
  const stepS = row("  of which sim steps", stepBlast);
  const sendS = row("  of which send", sendBlast);
  const perClientKbps = (bytesBlast / TEAMS / (blastTicks / 60)) * (8 / 1000);
  console.log(`  stream per client during blast turns: ${perClientKbps.toFixed(1)} kbit/s\n`);

  const rssMB = process.memoryUsage().rss / 1e6;
  console.log(`  process RSS with the match and 8 clients in it: ${rssMB.toFixed(0)} MB\n`);
  for (const c of clients) c.ws.terminate();
  await h.close();

  // ---------------------------------------------------------------- 3. realtime idle loop
  console.log("3. realtime 60 Hz loop, nobody acting (sink host), 3 s");
  const rt = new MatchRunner(
    MatchRunner.configFor(settingsFor(), TEAMS),
    [...Array(TEAMS).keys()].map(String),
    [...Array(TEAMS).keys()].map((k) => `m${k}`),
    sinkHost(),
    { ticker: "realtime" },
  );
  await new Promise((r) => setTimeout(r, 200));
  const base0 = process.cpuUsage();
  await new Promise((r) => setTimeout(r, 1000));
  const baseline = cpuMs(process.cpuUsage(base0)) / 1;
  rt.start(); // sends the 2 MB match.start: let that pass before measuring
  await new Promise((r) => setTimeout(r, 1000));
  const rt0 = process.cpuUsage();
  const rtTick0 = rt.tick;
  await new Promise((r) => setTimeout(r, 3000));
  const rtCpu = cpuMs(process.cpuUsage(rt0)) / 3;
  const rtTicks = (rt.tick - rtTick0) / 3;
  rt.stop();
  console.log(`  node idle baseline: ${ms(baseline)} CPU per second`);
  console.log(
    `  one idle match:     ${ms(rtCpu)} CPU per second (${rtTicks.toFixed(0)} ticks/s)\n`,
  );

  // ---------------------------------------------------------------- 4. against 0.1 CPU
  const budget = 1000 * QUOTA; // CPU ms available per wall second
  const idlePerSec = (idleS.mean / 3) * 60;
  const blastPerSec = (blastS.mean / 3) * 60;
  console.log(`4. against a ${QUOTA} CPU quota (${budget} CPU ms per second), same core speed`);
  console.log(
    `  idle turn:  ${ms(idlePerSec)} per second = ${((idlePerSec / budget) * 100).toFixed(0)}% of quota`,
  );
  console.log(
    `  blast turn: ${ms(blastPerSec)} per second = ${((blastPerSec / budget) * 100).toFixed(0)}% of quota`,
  );
  console.log(`  realtime idle match measured: ${((rtCpu / budget) * 100).toFixed(0)}% of quota`);
  console.log(
    `  worst blast batch ${ms(blastS.max)} CPU -> about ${ms(blastS.max / QUOTA)} wall when throttled`,
  );
  const startCost = genS.mean + vsS.mean;
  console.log(
    `  match start ${ms(startCost)} CPU -> about ${ms(startCost / QUOTA)} wall when throttled`,
  );
  void stepS;
  void sendS;
  console.log(
    `\nRESULT ${JSON.stringify({
      genMs: genS.mean,
      viewStartMs: vsS.mean,
      startMB: startBytes / 1e6,
      startWallMs: startWall,
      idleBatchMs: idleS.mean,
      blastBatch: blastS,
      blastStepMs: stepS.mean,
      blastSendMs: sendS.mean,
      kbpsPerClient: perClientKbps,
      rssMB,
      realtimeIdleCpuMsPerSec: rtCpu,
      nodeBaselineCpuMsPerSec: baseline,
    })}`,
  );
  process.exit(0);
}

void main();
