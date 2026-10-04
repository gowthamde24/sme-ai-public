import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  /** Forwarded to the API as a bearer token. The API verifies it again; never used for identity here. */
  accessToken: string;
};

/**
 * Data-access-layer gate for Server Components and Server Actions.
 *
 * Identity comes from `auth.getUser()`, which asks the Supabase Auth server to validate the token.
 * `auth.getSession()` only reads the cookie without verifying anything, so it is NEVER used to
 * decide who the caller is. It is called after `getUser()` has succeeded, and only to obtain the
 * access token to forward to the API (which re-verifies the signature, issuer and audience).
 */
export const requireUser = cache(async (): Promise<AuthenticatedUser> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) redirect("/login");

  return { id: data.user.id, email: data.user.email ?? null, accessToken };
});
