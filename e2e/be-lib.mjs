// Helpers of the real-stack end-to-end run (job BE): the REAL web, the REAL API (your own, on its own port) and the LOCAL Supabase with Storage. Local only, synthetic data only.
// Everything this run makes belongs to ONE throwaway account and workspace named e2e-<stamp>; `node cleanup-be.mjs` removes them. The owner's demo data is never touched.
import "./be-env.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { API, BASE, PW, factorSecret, supabasePublic, totp } from "./lib.mjs";

export { API, BASE, PW, totp };

const here = path.dirname(fileURLToPath(import.meta.url));
const PORTS_NOT_MINE = new Set(["3000", "8000", "8001"]);
for (const url of [BASE, API]) {
  if (PORTS_NOT_MINE.has(new URL(url).port)) {
    console.error(`e2e: refusing ${url}: ports 3000, 8000 and 8001 are somebody else's. Use 3002 for the web and 8002 for the API (the defaults of make e2e-local).`);
    process.exit(2);
  }
}

export const STAMP = process.env.E2E_STAMP || Date.now().toString(36);
export const EMAIL = `e2e-${STAMP}@e2e.example.test`;
export const SLUG_PREFIX = "e2e-";

const project = () => /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(here, "..", "supabase", "config.toml"), "utf8"))[1];

/** The name of the local database container this run talks to (docker exec): it is on this machine by construction, and the clean-up lock checks it. */
export const dbContainer = () => `supabase_db_${project()}`;

/** SQL in the LOCAL database container (docker exec): used for the local-only operator steps, never for data a person would make. */
export function psql(sql) {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
}

const { url: SUPABASE_URL, anon: ANON } = supabasePublic();
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) {
  console.error("e2e: not a local Supabase stack");
  process.exit(2);
}
export { SUPABASE_URL };

export async function gotrue(method, route, body, token) {
  const r = await fetch(SUPABASE_URL + route, { method, headers: { apikey: ANON, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  return { status: r.status, body: raw ? JSON.parse(raw) : null };
}

/** A token with the second factor answered (aal2), the way a person who typed the authenticator code has one. For setting up the data a person would already have, and for reading the API as them. */
export async function aal2Token(email = EMAIL) {
  const s = await gotrue("POST", "/auth/v1/token?grant_type=password", { email, password: PW });
  if (s.status !== 200) throw new Error(`sign-in for ${email} failed (HTTP ${s.status})`);
  let token = s.body.access_token;
  const user = await gotrue("GET", "/auth/v1/user", null, token);
  const factor = (user.body.factors || []).find((f) => f.status === "verified");
  if (!factor) return token;
  const secret = factorSecret(email);
  for (const offset of [0, 1, -1, 2]) {
    const c = await gotrue("POST", `/auth/v1/factors/${factor.id}/challenge`, {}, token);
    const v = await gotrue("POST", `/auth/v1/factors/${factor.id}/verify`, { challenge_id: c.body.id, code: totp(secret, offset) }, token);
    if (v.status === 200) return v.body.access_token;
  }
  throw new Error("the authenticator code was not accepted");
}

export async function api(method, route, body, token) {
  const r = await fetch(API + route, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // not JSON
  }
  return { status: r.status, body: json };
}

export const uuid = () => crypto.randomUUID();

/** The India hour right now (0 to 23): the outbox holds messages in quiet hours (default 21:00 to 09:00), which decides what "sent" can mean in this run. */
export const indiaHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

/**
 * The local database is ONE shared thing: an integration test session pins its clock database-wide (`app.outbox_now()` is replaced) and a reset or pgTAP run rebuilds it. This run reads the real clock (quiet hours) and keeps
 * data in the database for a few minutes, so it refuses to start while a test session is alive or the clock is pinned. Returns a sentence about what is wrong, or null.
 */
export function sharedDatabaseProblem() {
  const procs = execFileSync("ps", ["-axo", "command"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => /(^|\/)(python[0-9.]*|pytest|pg_prove)\b/.test(l) && /(pytest|pg_prove|supabase test)/.test(l) && !/^\/bin\/(zsh|bash|sh)\b/.test(l.trim()));
  if (procs.length) return `a test session is running (${procs[0].trim().slice(0, 80)}): wait for it`;
  const def = psql("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'outbox_now'");
  if (!/select now\(\)/.test(def)) return "the database clock is pinned by a test session (app.outbox_now is not now()): wait for it";
  return null;
}
