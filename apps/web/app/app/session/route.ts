import { type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

/** A request from this site only: the session cookie goes with any request to this address. */
function fromThisSite(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try {
    return origin !== null && host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * GET /app/session (job BW): "is this person still signed in?", for the page that has been open a while. The answer is only {signedIn: true} or a 401: no name, no token, no workspace. It asks the Auth server (getUser), the same
 * check requireUser() makes, so a revoked or expired session is a 401 here too. The proxy keeps the session fresh as it does for every /app request. Never cached; same-site requests only.
 */
export async function GET(request: NextRequest) {
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    // the Auth server could not be reached (the client reports a network failure as a retryable error with status 0, or a 5xx): that is an outage, not a sign-out
    if (error && (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500)) return new Response(JSON.stringify({ signedIn: null }), { status: 503, headers: NO_STORE });
    if (error || !data.user) return new Response(JSON.stringify({ signedIn: false }), { status: 401, headers: NO_STORE });
    return new Response(JSON.stringify({ signedIn: true }), { status: 200, headers: NO_STORE });
  } catch {
    return new Response(JSON.stringify({ signedIn: null }), { status: 503, headers: NO_STORE });
  }
}
