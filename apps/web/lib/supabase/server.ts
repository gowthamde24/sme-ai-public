import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "./config";
import { hardenCookieOptions } from "./cookies";

/**
 * A Supabase client bound to the current request's cookies, for Server Components, Server Actions
 * and Route Handlers. Create one per request; never share or cache it across requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hardenCookieOptions(options));
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Harmless: the proxy
          // refreshes the session on every /app and /login request.
        }
      },
    },
  });
}
