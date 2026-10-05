"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/lib/auth/form-state";
import { parseConfirmType, parseTokenHash } from "@/lib/auth/otp";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One message for expired, reused, malformed and wrong-type links alike: the page never says which. */
const BAD_LINK =
  "This link has expired or was already used. Request a new one.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Verifies the one-time token from an e-mail link, only when the person presses the button (a mail scanner that merely
 * FETCHES the link must not use it up). Then: an invite or a reset goes to choose a password; a plain e-mail
 * confirmation goes where `next` says, if (and only if) that is a same-site path.
 */
export async function confirmLink(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const type = parseConfirmType(field(formData, "type"));
  const tokenHash = parseTokenHash(field(formData, "token_hash"));
  if (!type || !tokenHash) return { error: BAD_LINK };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
  if (error) return { error: BAD_LINK };

  if (type === "email") redirect(safeRedirectPath(field(formData, "next")));
  redirect(`/auth/set-password?type=${type}`);
}
