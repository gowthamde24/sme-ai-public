/**
 * Cloudflare Turnstile on the public forms (the waitlist, the contact form and the sign-in after failures): a privacy-friendly check that a person, not a script, is sending the form. SERVER ONLY.
 * It is ON only when BOTH `TURNSTILE_SITE_KEY` (public, drawn in the page) and `TURNSTILE_SECRET_KEY` (a secret, from Secret Manager, never sent to a browser) are set; with neither, the forms work as they always did (local work, tests,
 * and a deploy before the owner has made the Cloudflare widget). When it is on, a form without a good token is refused: no token, a bad one, a used one, or a check that cannot be reached all mean "not checked" (it fails closed).
 * The token is single use: the browser asks for a fresh one after every try.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN = 2048;
const TIMEOUT_MS = 4000;

/** The public site key if the check is on, else null. */
export function turnstileSiteKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.TURNSTILE_SITE_KEY?.trim();
  return key && env.TURNSTILE_SECRET_KEY?.trim() ? key : null;
}

/** Did this token come from a person? True when the check is off. `fetchImpl` is for tests. */
export async function passesTurnstile(token: unknown, ip: string | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (turnstileSiteKey(env) === null) return true;
  if (typeof token !== "string" || token.length < 10 || token.length > MAX_TOKEN) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY as string, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return false;
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null && (json as { success?: unknown }).success === true;
  } catch {
    return false;
  }
}
