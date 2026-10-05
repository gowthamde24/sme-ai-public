"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/lib/auth/form-state";
import { parseTotpCode } from "@/lib/auth/otp";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { requireUserBeforeSecondFactor } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const WRONG_CODE =
  "That code did not work. Use the newest code from your authenticator app and check that your phone's clock is right.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The sign-in step after the password: answers the authenticator challenge, which makes the session aal2. */
export async function verifyCode(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  await requireUserBeforeSecondFactor(); // a session is needed; a password-only one is exactly what this page is for
  const code = parseTotpCode(field(formData, "code"));
  if (!code) return { error: "Enter the six digits from your authenticator app." };

  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect("/app/security");
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) return { error: WRONG_CODE };
  redirect(safeRedirectPath(field(formData, "next")));
}

/** Sign out from the challenge page (the app's own sign-out is behind the challenge). */
export async function leaveChallenge(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
