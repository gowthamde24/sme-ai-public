// The safety lock of the real-stack clean-up (job BF). cleanup-be.mjs switches the row guards off (session_replication_role = replica) so it can delete a throwaway workspace; that power must never reach a
// shared, hosted or real database, or a workspace that is not ours. So it refuses to run unless EVERY database address it can see is this machine (localhost, 127.0.0.1, ::1, the Docker host or the local
// Supabase container) AND every workspace it would remove has a slug starting with "e2e-". Pure functions, no I/O: apps/web/scripts/e2e-cleanup-guard.test.ts pins them.

export const SLUG_PREFIX = "e2e-";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal", "gateway.docker.internal"]);
const LOCAL_CONTAINER = /^supabase_db_[a-z0-9_-]+$/; // no dots: supabase_db_x.example.com is a real host name

/** The host of a URL, a "host:port" or a bare host name, lower case, or null when there is none. */
export function hostOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const v = value.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return new URL(v).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) return bracket[1].toLowerCase();
  if (v.split(":").length === 2) return v.replace(/:\d+$/, "").toLowerCase(); // host:port; a bare IPv6 address (::1) has more colons
  return v.toLowerCase();
}

/** True only for this machine: localhost, 127.0.0.1, ::1, the Docker host, or the local Supabase database container. Anything else, including a look-alike such as localhost.example.com, is not local. */
export function isLocalDatabaseHost(value) {
  const host = hostOf(value);
  return host !== null && (LOCAL_HOSTS.has(host) || LOCAL_CONTAINER.test(host));
}

/** The environment variables that can name a database or the service in front of it. */
export const DATABASE_ENV = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DB_HOST", "PGHOST", "E2E_DB_HOST"];

/**
 * A sentence saying why the clean-up must not run, or null when it may. `hosts` are the database addresses (from the environment and the container it will talk to); `slugs` are the slugs of the workspaces it
 * would delete. At least one host must be known, every one must be local, and every slug must start with "e2e-".
 */
export function cleanupRefusal({ hosts, slugs }) {
  const known = (hosts ?? []).filter((h) => typeof h === "string" && h.trim() !== "");
  if (known.length === 0) return "cannot tell which database this is (no host is known), so nothing is deleted";
  const away = known.find((h) => !isLocalDatabaseHost(h));
  if (away !== undefined) return `the database host "${hostOf(away) ?? away}" is not this machine (only localhost, 127.0.0.1, ::1, the Docker host or the local Supabase container are allowed), so nothing is deleted`;
  const odd = (slugs ?? []).find((s) => typeof s !== "string" || !s.startsWith(SLUG_PREFIX));
  if (odd !== undefined) return `the workspace "${String(odd)}" does not start with "${SLUG_PREFIX}", so nothing is deleted`;
  return null;
}

/** The database addresses in an environment (process.env), for cleanupRefusal. */
export function hostsFromEnv(env, container) {
  const out = [];
  for (const name of DATABASE_ENV) if (typeof env[name] === "string" && env[name].trim() !== "") out.push(env[name]);
  if (container) out.push(container);
  return out;
}
