import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicConfig } from "./config";
import { hardenCookieOptions } from "./cookies";

/**
 * Refreshes the Supabase session for a request and reports who (if anyone) is signed in.
 *
 * Uses `auth.getUser()`, which validates the token with the Auth server, and never trusts the raw
 * cookie. Any failure (network, expired refresh token, malformed cookie) is treated as signed out.
 * Cookies the refresh wants to set are copied onto the returned response, together with the
 * no-store headers the library supplies so a CDN can never cache one user's session for another.
 */
export async function refreshSession(
  request: NextRequest,
): Promise<{
  response: NextResponse;
  user: User | null;
  /** The person has an authenticator but this session is password-only (aal1): the app must send them to the challenge. */
  needsSecondFactor: boolean;
}> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, hardenCookieOptions(options));
        }
        for (const [key, value] of Object.entries(headers))
          response.headers.set(key, value);
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getUser();
    const user = error ? null : data.user;
    return { response, user, needsSecondFactor: user ? await needsChallenge(supabase, user) : false };
  } catch {
    return { response, user: null, needsSecondFactor: false };
  }
}

type Factor = { status?: string; factor_type?: string };

/** An enrolled person on a password-only session. Fails closed: if the level cannot be read it counts as aal1. */
async function needsChallenge(
  supabase: ReturnType<typeof createServerClient>,
  user: User,
): Promise<boolean> {
  const enrolled = ((user.factors ?? []) as Factor[]).some(
    (f) => f.status === "verified" && f.factor_type === "totp",
  );
  if (!enrolled) return false;
  let level: string | null = null;
  try {
    const result = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    level = result.data?.currentLevel ?? null;
  } catch {
    level = null; // unreadable: counts as password-only
  }
  return level !== "aal2";
}
