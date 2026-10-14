import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Google or Facebook sends the browser back to (job CL, PKCE flow): swaps the one-time `code` for a session, then goes to /app (which sends a new account to the first-login setup). The destination is NEVER taken from
 * the address: it is always /app, so this cannot be turned into an open redirect. A refusal by the person at the provider, a missing, reused or expired code all end the same way: back to the sign-in page with one closed
 * word. Nothing from the address is echoed.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const failed = NextResponse.redirect(new URL("/login?notice=provider", request.url));
  if (!code || code.length > 512) return failed;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed;
  return NextResponse.redirect(new URL("/app", request.url));
}
