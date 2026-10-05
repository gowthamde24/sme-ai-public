import { type NextRequest, NextResponse } from "next/server";

import { buildCsp, newNonce } from "@/lib/security/csp";
import { refreshSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 "proxy" (formerly middleware). Three jobs:
 *  1. give EVERY page a Content-Security-Policy with a fresh nonce (lib/security/csp.ts);
 *  2. keep the Supabase session fresh (rotates tokens, rewrites cookies);
 *  3. send signed-out visitors of /app to /login, signed-in visitors of /login to /app, and a person who has an
 *     authenticator but a password-only session to the code challenge (ADR 0016).
 *
 * Jobs 2 and 3 are optimistic, NOT the security boundary. Server Components and Actions re-authenticate with
 * `requireUser()` (auth.getUser plus the assurance level), and the API re-verifies the JWT and RLS decides data access.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  // Next.js reads the nonce from the REQUEST's policy header while it renders.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  const { pathname, search } = request.nextUrl;
  const needsSession =
    pathname.startsWith("/app") ||
    pathname === "/login" ||
    pathname.startsWith("/auth/");

  if (!needsSession) {
    const response = NextResponse.next({ request });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const { response, user, needsSecondFactor } = await refreshSession(request);

  if (!user && pathname.startsWith("/app")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return redirectWithCookies(login, response, csp);
  }
  if (user && pathname === "/login") {
    return redirectWithCookies(new URL("/app", request.url), response, csp);
  }
  if (user && needsSecondFactor && pathname.startsWith("/app")) {
    const challenge = new URL("/auth/mfa", request.url);
    challenge.searchParams.set("next", pathname + search);
    return redirectWithCookies(challenge, response, csp);
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** A redirect must carry any cookies the session refresh just set (or cleared). */
function redirectWithCookies(target: URL, from: NextResponse, csp: string) {
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  from.headers.forEach((value, key) => {
    if (key === "cache-control" || key === "expires" || key === "pragma") {
      redirect.headers.set(key, value);
    }
  });
  redirect.headers.set("Content-Security-Policy", csp);
  return redirect;
}

// Every page, but not static assets or prefetches (they need no policy of their own).
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
