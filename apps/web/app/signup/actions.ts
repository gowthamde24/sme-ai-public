"use server";

import { headers } from "next/headers";

import { getLang } from "@/i18n/get-lang";
import { defaultBusinessName, parseSignupPack } from "@/lib/packs/signup";

import { clientIp, sharedSignupLimiter } from "@/lib/auth/signup-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { SignUpInput, SignUpResult } from "@/lib/api/signup";

import { runSignUp } from "./signup-logic";

/**
 * Open sign-up (job AD / D2): `signUp({ name, email, password, businessName, acceptTerms })` ->
 * `{ ok: true, next: "check-email" }` (also for an address that already has an account: no enumeration) or
 * `{ ok: false, error: "weak_password" | "terms_required" | "too_many_signups" | "invalid" }`.
 * The logic is in signup-logic.ts; this wrapper only supplies the Auth client, the per-address brake and the caller's address.
 */
export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const supabase = await createSupabaseServerClient();
  // the two-step sign-up (job CL) asks only the kind of business and how to sign in: the name comes from the address, the business gets the pack's neutral name until the checklist asks the real one
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : ""); // a server action's input is whatever the browser sent
  const type = parseSignupPack(input?.businessType);
  const filled: SignUpInput = {
    ...input,
    name: text(input?.name) || text(input?.email).split("@")[0].slice(0, 100),
    businessName: text(input?.businessName) || defaultBusinessName(type ?? "", await getLang()),
  };
  return runSignUp(filled, {
    auth: supabase.auth,
    limiter: sharedSignupLimiter(),
    ip: clientIp(await headers()),
  });
}
