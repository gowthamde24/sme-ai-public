// Starts `next start` on an unused port for the audits that need the real, compiled page (the app must be built
// first: `npm run build`). It records the PID and stops that PID only; it never kills anything by name and never
// touches a port that is already answering. The Supabase variables are public dummies on a reserved host that never
// resolves (RFC 6761 ".invalid"): the public landing page makes no Supabase call, and nothing can be sent anywhere.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sleep } from "./chrome.mjs";
import { ROOT } from "./leak-audit.mjs";

const DUMMY_ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "audit-dummy-public-key" };

async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

export async function startNext(port = Number(process.env.APP_PORT ?? 4175)) {
  if (!fs.existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("No production build found. Run `npm run build` first.");
  if (await answers(port)) throw new Error(`port ${port} is already in use; not touching it (set APP_PORT)`);
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, ...DUMMY_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const t0 = Date.now();
  while (!(await answers(port))) {
    if (Date.now() - t0 > 30000) {
      child.kill("SIGTERM");
      throw new Error(`next start did not answer in 30 s: ${log}`);
    }
    await sleep(250);
  }
  const stop = () => {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stop);
  return { base: `http://127.0.0.1:${port}`, pid: child.pid, stop, log: () => log };
}

/** The four languages the page ships in. */
export const LANGS = ["en", "te", "hi", "kn"];
