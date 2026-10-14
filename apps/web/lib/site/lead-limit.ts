import { createSignupLimiter, type SignupLimiter } from "@/lib/auth/signup-limit";

/** At most N tries an hour from one address (SITE_LEAD_MAX_PER_HOUR, default 10): a best-effort brake in this server's memory, the same kind as the sign-up's (lib/auth/signup-limit.ts). It keeps no personal data. */
export const DEFAULT_LEAD_PER_HOUR = 10;

export function parseLeadLimit(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,3}$/.test(raw.trim())) return DEFAULT_LEAD_PER_HOUR;
  const n = Number(raw.trim());
  return n >= 1 && n <= 500 ? n : DEFAULT_LEAD_PER_HOUR;
}

let shared: SignupLimiter | undefined;
export function sharedLeadLimiter(): SignupLimiter {
  shared ??= createSignupLimiter({ maxPerHour: parseLeadLimit(process.env.SITE_LEAD_MAX_PER_HOUR) });
  return shared;
}
