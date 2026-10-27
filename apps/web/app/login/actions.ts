"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { clientIp } from "@/lib/auth/signup-limit";
import { CHECK_AFTER, FAILS_COOKIE, FAILS_SECONDS } from "@/lib/auth/signin-fails";
import { passesTurnstile, turnstileSiteKey } from "@/lib/security/turnstile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** `check`: the form must now show the Turnstile box (three failures in a row). */
export type AuthFormState = { error?: string; message?: string; check?: boolean } | undefined;


const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 72; // bcrypt's limit; longer passwords would be silently truncated

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Sign-up is OPEN since job AD / D2: see app/signup/actions.ts. Invited accounts and their flows are unchanged.

/** Server-side validation. The form's HTML attributes are a convenience, never the control. */
function credentials(
  formData: FormData,
): { email: string; password: string } | null {
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  if (!EMAIL.test(email) || email.length > MAX_EMAIL) return null;
  if (password.length < 1 || password.length > MAX_PASSWORD) return null;
  return { email, password };
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const creds = credentials(formData);
  if (!creds) return { error: "Enter a valid email and password." };

  const jar = await cookies();
  const fails = Math.min(Number.parseInt(jar.get(FAILS_COOKIE)?.value ?? "0", 10) || 0, 99);
  const checking = turnstileSiteKey() !== null && fails >= CHECK_AFTER;
  if (checking && !(await passesTurnstile(field(formData, "cf-turnstile-response"), clientIp(await headers())))) return { error: "Tick the box that checks you are a person, then sign in again.", check: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  const failed = () => jar.set(FAILS_COOKIE, String(fails + 1), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: FAILS_SECONDS });
  // A person who signed up and has not yet used the link we sent: said plainly (the password was right, so this reveals nothing).
  if (error?.code === "email_not_confirmed")
    return { error: "Confirm your email first: use the link we sent you." };
  // One generic message for unknown user and wrong password alike.
  if (error) {
    failed();
    return { error: "Invalid email or password.", ...(turnstileSiteKey() !== null && fails + 1 >= CHECK_AFTER ? { check: true } : {}) };
  }
  jar.delete(FAILS_COOKIE);

  const next = safeRedirectPath(field(formData, "next"));
  // A person with an authenticator is not signed in until they have used it (ADR 0016).
  const level = await supabase.auth.mfa
    .getAuthenticatorAssuranceLevel()
    .then((r) => r.data)
    .catch(() => null);
  if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2")
    redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  redirect(next);
}
