"use server";

import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string } | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt's limit; longer passwords would be silently truncated

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  // One generic message for unknown user and wrong password alike.
  if (error) return { error: "Invalid email or password." };

  redirect(safeRedirectPath(field(formData, "next")));
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const creds = credentials(formData);
  if (!creds) return { error: "Enter a valid email and password." };
  if (creds.password.length < MIN_PASSWORD) {
    return {
      error: `Use at least ${MIN_PASSWORD} characters for your password.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp(creds);
  if (error) {
    if (error.code === "weak_password")
      return { error: "That password is too weak." };
    return { error: "Could not create the account." };
  }

  if (!data.session) {
    // Email confirmation is enabled: no session until the link is followed. The message is the
    // same whether or not the address already has an account (no account enumeration).
    return { message: "Check your email to finish creating your account." };
  }
  redirect(safeRedirectPath(field(formData, "next")));
}
