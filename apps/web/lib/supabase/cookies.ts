import type { CookieOptions } from "@supabase/ssr";

/**
 * Session cookie hardening. Auth happens only on the server (server actions + proxy), so the
 * browser never needs to read the tokens: HttpOnly keeps them away from page scripts (XSS).
 *
 * HOST-ONLY (job CE, ADR 0072). With the web at app.<domain> and the API at api.<domain>, the session cookie
 * must belong to app.<domain> alone: no `Domain` attribute, whatever a caller passes. A cookie with
 * `Domain=<domain>` would also go to api.<domain> and to every other subdomain; the API never needs it (the web
 * server calls the API with the person's token in an Authorization header) and a sibling subdomain must not be
 * able to read or overwrite it.
 */
export function hardenCookieOptions(
  options: CookieOptions = {},
): CookieOptions {
  const hardened: CookieOptions = {
    ...options,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
  delete hardened.domain;
  return hardened;
}
