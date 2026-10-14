"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SITE_URL } from "@/lib/seo/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSignupPack, SIGNUP_PACK_COOKIE, SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/packs/signup";

/**
 * "Continue with Google / Facebook" (job CL): step 2 of the sign-up. Remembers the kind of business, then sends the browser to the provider through the Auth server (PKCE: the code verifier is kept in the
 * Auth cookies by the server client). The return is `/auth/callback`. When the provider is not switched on yet (Google needs the domain and its verification, Facebook the Meta app) the Auth server refuses and
 * the person is sent back to step 2 with a plain sentence; nothing is created. The terms: the person is shown the line "By continuing you agree" and the acceptance is recorded with the version on the accept
 * page after the first sign-in (an account made through a provider has no sign-up form to carry the versions).
 */
export async function continueWithProvider(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  const pack = parseSignupPack(formData.get("type"));
  if (!pack) redirect("/signup");
  if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) redirect(`/signup?type=${pack}`);
  const jar = await cookies();
  jar.set(SIGNUP_PACK_COOKIE, pack, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60, path: "/" });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: provider as SocialProvider, options: { redirectTo: `${SITE_URL}/auth/callback`, skipBrowserRedirect: true } });
  if (error || !data?.url) redirect(`/signup?type=${pack}&error=provider`);
  redirect(data.url);
}
