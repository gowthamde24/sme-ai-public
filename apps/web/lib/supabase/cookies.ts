import type { CookieOptions } from "@supabase/ssr";

/**
 * Session cookie hardening. Auth happens only on the server (server actions + proxy), so the
 * browser never needs to read the tokens: HttpOnly keeps them away from page scripts (XSS).
 */
export function hardenCookieOptions(
  options: CookieOptions = {},
): CookieOptions {
  return {
    ...options,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}
