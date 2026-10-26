import { type NextRequest, NextResponse } from "next/server";

import { buildCsp, newNonce, storageOrigin } from "@/lib/security/csp";
import { isClosedPath, websiteOnly } from "@/lib/site/mode";
import { refreshSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 "proxy" (formerly middleware). Three jobs:
 *  1. give EVERY page a Content-Security-Policy with a fresh nonce (lib/security/csp.ts);
 *  2. keep the Supabase session fresh (rotates tokens, rewrites cookies);
 *  0. in website mode (SITE_MODE=website, job DQ) the app and every sign-in page answer with "Opening soon — book a demo" (the page /opening-soon), and /landing is the home page; nothing below runs;
 *  3. send signed-out visitors of /app to /login, signed-in visitors of /login to /app, and a person who has an
 *     authenticator but a password-only session to the code challenge (ADR 0016).
 *
 * Jobs 2 and 3 are optimistic, NOT the security boundary. Server Components and Actions re-authenticate with
 * `requireUser()` (auth.getUser plus the assurance level), and the API re-verifies the JWT and RLS decides data access.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", storageOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL));
  // Next.js reads the nonce from the REQUEST's policy header while it renders.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  const { pathname, search } = request.nextUrl;
  // where the person is, for requireUser(): a signed-out redirect from deep in a page can then carry ?next= (job BW). Always set here, so a caller cannot choose it.
  request.headers.set("x-sme-path", pathname + search);
  if (websiteOnly()) {
    const closed = isClosedPath(pathname) ? NextResponse.rewrite(new URL("/opening-soon", request.url), { request }) : pathname === "/landing" ? NextResponse.redirect(new URL("/", request.url), 308) : null;
    if (closed) {
      closed.headers.set("Content-Security-Policy", csp);
      return closed;
    }
  }
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
  // the page where an invitation code is entered (job CC): nothing of its address may leave in a Referer header
  if (pathname === "/app/join") response.headers.set("Referrer-Policy", "no-referrer");
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
