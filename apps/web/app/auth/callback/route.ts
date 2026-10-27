import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Google or Facebook sends the browser back to (job CL, PKCE flow): swaps the one-time `code` for a session, then goes to /app (which sends a new account to the first-login setup). The destination is NEVER taken from
 * the address: it is always /app, so this cannot be turned into an open redirect. A refusal by the person at the provider, a missing, reused or expired code all end the same way: back to the sign-in page with one closed
 * word. Nothing from the address is echoed. One refusal has its own closed word: while the Auth server's sign-up is off, a Google address without an account is refused by the Auth server (`error_code=signup_disabled`), and the
 * sign-in page says so plainly instead of "try again".
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const noAccount = request.nextUrl.searchParams.get("error_code") === "signup_disabled";
  const failed = NextResponse.redirect(new URL(`/login?notice=${noAccount ? "nosignup" : "provider"}`, request.url));
  if (!code || code.length > 512) return failed;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed;
  return NextResponse.redirect(new URL("/app", request.url));
}
