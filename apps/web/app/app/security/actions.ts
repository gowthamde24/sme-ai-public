"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/lib/auth/form-state";
import { parseTotpCode } from "@/lib/auth/otp";
import { safeQr } from "@/lib/auth/qr";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EnrolState =
  | { error?: string; factorId?: string; qr?: string | null; secret?: string }
  | undefined;

const WRONG_CODE =
  "That code did not work. Use the newest code from your authenticator app and check that your phone's clock is right.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Step 1: a new authenticator for someone who has none. Anything half-finished from before is removed first. */
export async function startEnrolment(): Promise<EnrolState> {
  const user = await requireUser();
  if (user.hasSecondFactor)
    return { error: "You already have an authenticator." };
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const stale of existing?.all ?? [])
    if (stale.status !== "verified")
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (error || !data)
    return { error: "Could not start the setup. Try again." };
  return {
    factorId: data.id,
    qr: safeQr(data.totp.qr_code),
    secret: data.totp.secret,
  };
}

/** Step 2: the person proves the app works by typing a code. That makes this session aal2. */
export async function finishEnrolment(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  await requireUser();
  const code = parseTotpCode(field(formData, "code"));
  const factorId = field(formData, "factor_id");
  if (!code) return { error: "Enter the six digits from your authenticator app." };
  if (!/^[0-9a-f-]{36}$/i.test(factorId))
    return { error: "This setup is out of date. Start again." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: WRONG_CODE };
  redirect("/app/security?done=1");
}

/** Removing an authenticator needs a FRESH code typed now (verified first), on top of the Auth server's own aal2 rule. */
export async function removeAuthenticator(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await requireUser();
  if (!user.hasSecondFactor) redirect("/app/security");
  const code = parseTotpCode(field(formData, "code"));
  if (!code) return { error: "Enter the six digits from your authenticator app." };
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect("/app/security");
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verified.error) return { error: WRONG_CODE };
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return { error: "Could not remove it. Try again." };
  redirect("/app/security?removed=1");
}
