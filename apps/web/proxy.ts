import { type NextRequest, NextResponse } from "next/server";

import { refreshSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 "proxy" (formerly middleware). Two jobs, both optimistic:
 *  1. keep the Supabase session fresh (rotates tokens, rewrites cookies);
 *  2. send signed-out visitors of /app to /login, and signed-in visitors of /login to /app.
 *
 * This is NOT the security boundary. Server Components and Actions re-authenticate with
 * `requireUser()` (auth.getUser), and the API re-verifies the JWT and RLS decides data access.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && pathname.startsWith("/app")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return redirectWithCookies(login, response);
  }
  if (user && pathname === "/login") {
    return redirectWithCookies(new URL("/app", request.url), response);
  }
  return response;
}

/** A redirect must carry any cookies the session refresh just set (or cleared). */
function redirectWithCookies(target: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  from.headers.forEach((value, key) => {
    if (key === "cache-control" || key === "expires" || key === "pragma") {
      redirect.headers.set(key, value);
    }
  });
  return redirect;
}

// Only the routes that need a session. Everything else (including "/") never touches Auth.
export const config = {
  matcher: ["/app/:path*", "/login"],
};
