"use server";

import type { AuthFormState } from "@/lib/auth/form-state";
import { RESET_MESSAGE } from "@/lib/auth/messages";
import { padTo } from "@/lib/auth/otp";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Every outcome of a well-formed request takes at least this long. */
const MIN_MILLISECONDS = 800;

/**
 * Asks for a password-reset e-mail. The answer is the SAME whether or not the address has an account, whether the mail was
 * sent, or whether the Auth server complained (rate limit included): no account enumeration. Responses are also held to a
 * minimum duration, so a fast "no such account" cannot be told from a slow "sent". The link in the mail comes from the
 * project's own template and Site URL (docs/runbooks/hosted-auth-settings.md); no redirect target is taken from the request.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const started = Date.now();
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254)
    return { error: "Enter a valid email address." };
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email);
  } catch {
    // swallowed on purpose: the outcome must not depend on the address
  }
  await padTo(started, MIN_MILLISECONDS);
  return { message: RESET_MESSAGE };
}
