"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SITE_URL } from "@/lib/seo/site";
import { providerIsOn } from "@/lib/supabase/authorize-probe";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPacks } from "@/lib/api/pack";
import { pickSignupPack, SIGNUP_PACK_COOKIE, SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/packs/signup";

/**
 * "Continue with Google / Facebook" (job CL): step 2 of the sign-up. Remembers the kind of business, then sends the browser to the provider through the Auth server (PKCE: the code verifier is kept in the
 * Auth cookies by the server client). The return is `/auth/callback`. When the provider is not switched on yet (Google needs the domain and its verification, Facebook the Meta app) the Auth server refuses and
 * the person is sent back to step 2 with a plain sentence; nothing is created (and step 2 shows the buttons only for the providers `GET /v1/auth/providers` says are on). The terms: the person is shown the line "By continuing you agree"
 * and the first-login setup records the versions in force (an account made through a provider has no sign-up form to carry them; job CK).
 */
export async function continueWithProvider(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  // the kind must be one of the cards the API offers (a server that cannot say sends the person back to step 1, which says so)
  const pack = pickSignupPack(await listPacks().catch(() => []), formData.get("type"));
  if (!pack) redirect("/signup");
  if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) redirect(`/signup?type=${pack}`);
  const jar = await cookies();
  jar.set(SIGNUP_PACK_COOKIE, pack, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60, path: "/" });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: provider as SocialProvider, options: { redirectTo: `${SITE_URL}/auth/callback`, skipBrowserRedirect: true } });
  if (error || !data?.url) redirect(`/signup?type=${pack}&error=provider`);
  // `signInWithOAuth` only BUILDS the address: whether the Auth server has the provider switched on shows when the address is followed (found by the real-stack run: the browser landed on a JSON 400 page). So the address is
  // asked once from here, without following it: a provider that is on answers with a redirect to the provider, one that is off with a refusal, and the person goes back to step 2 with one sentence instead.
  if (!(await providerIsOn(data.url))) redirect(`/signup?type=${pack}&error=provider`);
  redirect(data.url);
}
