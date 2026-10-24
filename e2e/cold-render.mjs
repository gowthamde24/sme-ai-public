// Job DH: how long the FIRST render of a page takes on a fresh server (the cold render a visitor meets after Cloud Run starts an instance), on a production build already made in apps/web/.next.
//   node e2e/cold-render.mjs [--paths /login,/privacy,/] [--runs 5] [--port 3017]
// For each path and each run: start `next start`, wait until it answers on the port, time the first GET of the path (to the last byte), time the second GET, stop the server (only the one this script started, by its pid).
// Prints the median and the spread; nothing leaves this machine (the dummy Supabase address is never contacted by these pages).
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "apps", "web");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PATHS = arg("paths", "/login,/privacy,/").split(",");
const RUNS = Number(arg("runs", "5"));
const PORT = Number(arg("port", "3017"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
if (await busy(PORT)) throw new Error(`port ${PORT} is already in use (nothing is killed: free it or pick --port)`);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {};
for (const p of PATHS) {
  const first = [];
  const second = [];
  const ready = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    const srv = spawn(process.execPath, [path.join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: WEB,
      env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:54999", NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: "https://127.0.0.1:54999" },
      stdio: "ignore",
    });
    while (!(await busy(PORT))) await sleep(50);
    ready.push(Date.now() - t0);
    const a = Date.now();
    const r1 = await fetch(`http://127.0.0.1:${PORT}${p}`, { redirect: "manual" });
    await r1.arrayBuffer();
    first.push(Date.now() - a);
    const b = Date.now();
    const r2 = await fetch(`http://127.0.0.1:${PORT}${p}`, { redirect: "manual" });
    await r2.arrayBuffer();
    second.push(Date.now() - b);
    if (r1.status !== 200) console.log(`  (${p}: HTTP ${r1.status})`);
    srv.kill("SIGTERM"); // our own child, by its own process id
    await new Promise((r) => srv.on("exit", r));
    await sleep(300);
  }
  out[p] = { firstMedian: median(first), firstAll: first, secondMedian: median(second), readyMedian: median(ready) };
  console.log(`${p.padEnd(10)} first request: median ${out[p].firstMedian} ms (${first.join(", ")})   second: median ${out[p].secondMedian} ms   server ready: median ${out[p].readyMedian} ms`);
}
console.log(JSON.stringify(out));
