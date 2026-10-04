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
): Promise<{ response: NextResponse; user: User | null }> {
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
    return { response, user: error ? null : data.user };
  } catch {
    return { response, user: null };
  }
}
