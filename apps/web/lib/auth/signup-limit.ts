/**
 * A best-effort brake on sign-ups from one address: at most N per hour (SIGNUP_MAX_PER_HOUR, default 5). It lives in this server process's
 * memory, so it is NOT shared between instances and starts again on a restart; it keeps no personal data (the key is only held in memory,
 * for an hour, and the number of keys is capped). It slows a script that uses the sign-up form. It does not stop someone who talks to the
 * Auth server directly; that is the Auth server's own rate limit (supabase/config.toml [auth.rate_limit]; the hosted values are a
 * pre-pilot checklist row).
 */
export const DEFAULT_MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const MAX_KEYS = 10_000;

/** The configured limit: a whole number from 1 to 1000, else the default. */
export function parseMaxPerHour(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,4}$/.test(raw.trim())) return DEFAULT_MAX_PER_HOUR;
  const n = Number(raw.trim());
  return n >= 1 && n <= 1000 ? n : DEFAULT_MAX_PER_HOUR;
}

export interface SignupLimiter {
  /** True and counted when this address is under the limit; false (and not counted) when it is at it. */
  allow(key: string): boolean;
}

export function createSignupLimiter(options: { maxPerHour: number; now?: () => number }): SignupLimiter {
  const now = options.now ?? Date.now;
  const seen = new Map<string, number[]>();
  return {
    allow(key: string): boolean {
      const t = now();
      const recent = (seen.get(key) ?? []).filter((at) => t - at < HOUR_MS);
      if (recent.length >= options.maxPerHour) {
        seen.set(key, recent);
        return false;
      }
      recent.push(t);
      seen.delete(key); // re-insert last, so the oldest keys are the first to go when the map is full
      seen.set(key, recent);
      if (seen.size > MAX_KEYS) {
        for (const [k, times] of seen) {
          if (times.every((at) => t - at >= HOUR_MS) || seen.size > MAX_KEYS) seen.delete(k);
          if (seen.size <= MAX_KEYS) break;
        }
      }
      return true;
    },
  };
}

/** The address a request came from, as the hosting layer reports it: the first entry of x-forwarded-for, else x-real-ip, else "unknown". */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : "unknown";
}

let shared: SignupLimiter | undefined;
/** The process-wide limiter, built on first use from the environment. */
export function sharedSignupLimiter(): SignupLimiter {
  shared ??= createSignupLimiter({ maxPerHour: parseMaxPerHour(process.env.SIGNUP_MAX_PER_HOUR) });
  return shared;
}
