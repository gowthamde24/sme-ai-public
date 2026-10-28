"use server";

import { redirect } from "next/navigation";

import { SITE_URL } from "@/lib/seo/site";
import { providerIsOn } from "@/lib/supabase/authorize-probe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * "Continue with Google" on the SIGN-IN page: it signs in people who already have an account, nothing else. It needs no sign-up to be open and it makes nobody: whether an unknown Google address may create an account is
 * the Auth server's setting ("Allow new users to sign up"), and while that is off the Auth server refuses it and the return (`/auth/callback`) says so with one closed word. No kind of business is remembered here (that is
 * step 2 of the sign-up, `app/signup/oauth-actions.ts`). The address of the provider is asked once without being followed (a provider that is off answers with a refusal) so the person never lands on a JSON page.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${SITE_URL}/auth/callback`, skipBrowserRedirect: true } });
  if (error || !data?.url) redirect("/login?notice=provider");
  if (!(await providerIsOn(data.url))) redirect("/login?notice=provider");
  redirect(data.url);
}
