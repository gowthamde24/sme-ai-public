"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/lib/auth/form-state";
import { validateNewPassword } from "@/lib/auth/password-policy";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Chooses a password for the signed-in session an invite or a reset link just created. The policy is checked here (the form's
 * attributes are a convenience). On success every OTHER session of the person ends, so a reset also removes whoever else was in.
 */
export async function setPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await requireUser(); // no session: to /login; has an authenticator but not used: to the code challenge
  const problem = validateNewPassword(
    field(formData, "password"),
    field(formData, "confirm"),
    user.email,
  );
  if (problem) return { error: problem };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: field(formData, "password"),
  });
  if (error) {
    if (error.code === "weak_password")
      return { error: "That password is too easy to guess. Choose a longer or less common one." };
    if (error.code === "same_password")
      return { error: "Choose a password you have not used before." };
    return {
      error: "Could not set the password. The link may have expired: request a new one.",
    };
  }
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  redirect("/app");
}
