"use server";

import { headers } from "next/headers";

import { clientIp, sharedSignupLimiter } from "@/lib/auth/signup-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { SignUpInput, SignUpResult } from "@/lib/api/signup";

import { runSignUp } from "./signup-logic";

/**
 * Open sign-up (job AD / D2): `signUp({ name, email, password, businessName, acceptTerms })` ->
 * `{ ok: true, next: "check-email" }` or `{ ok: false, error: "email_taken" | "weak_password" | "terms_required" | "too_many_signups" | "invalid" }`.
 * The logic is in signup-logic.ts; this wrapper only supplies the Auth client, the per-address brake and the caller's address.
 */
export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const supabase = await createSupabaseServerClient();
  return runSignUp(input, {
    auth: supabase.auth,
    limiter: sharedSignupLimiter(),
    ip: clientIp(await headers()),
  });
}
