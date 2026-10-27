import { apiPublicRequest } from "@/lib/api/client";

/**
 * Cloudflare Turnstile on the public forms (the waitlist, the contact form and the sign-in after failures): a privacy-friendly check that a person, not a script, is sending the form. SERVER ONLY.
 * The web holds NO secret (a test of the hosting list keeps it so): the site key is public and is the only setting here (`TURNSTILE_SITE_KEY`); the token is checked by the API (`POST /v1/public/turnstile/verify`, C1: it holds the
 * Cloudflare secret and asks Cloudflare). The check is ON when the site key is set; set it only after the API has the endpoint. When on, a form without a good token is refused: no token, a bad one, a used one, or a check that cannot be
 * reached all mean "not checked" (it fails closed). With no site key the forms work as they always did (local work, tests, a deploy before the owner has made the Cloudflare widget). The token is single use: the browser asks for a fresh one after every try.
 */
const MAX_TOKEN = 2048;

export type Verify = (token: string, ip: string | null) => Promise<boolean>;

/** The API's answer: `{ ok: true }` for a person. Anything else (an error, another shape) is "no". */
const viaApi: Verify = async (token, ip) => {
  try {
    const out = await apiPublicRequest("/v1/public/turnstile/verify", { method: "POST", body: { token, ...(ip ? { ip } : {}) } });
    return typeof out === "object" && out !== null && (out as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
};

/** The public site key if the check is on, else null. */
export function turnstileSiteKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.TURNSTILE_SITE_KEY?.trim() || null;
}

/** Did this token come from a person? True when the check is off. `verify` is for tests. */
export async function passesTurnstile(token: unknown, ip: string | null, env: Record<string, string | undefined> = process.env, verify: Verify = viaApi): Promise<boolean> {
  if (turnstileSiteKey(env) === null) return true;
  if (typeof token !== "string" || token.length < 10 || token.length > MAX_TOKEN) return false;
  return verify(token, ip);
}
