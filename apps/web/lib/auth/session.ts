import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  /** Forwarded to the API as a bearer token. The API verifies it again; never used for identity here. */
  accessToken: string;
  /** The session's assurance level: "aal2" only after a valid authenticator code (ADR 0016). */
  aal: "aal1" | "aal2";
  /** Whether the person has a verified authenticator (from the Auth server, via getUser). */
  hasSecondFactor: boolean;
};

type Factor = { status?: string; factor_type?: string };

/**
 * Where to send a signed-out person (job BW): the sign-in page with `?next=` set to the page they were on, so signing in again brings them back to it. The proxy puts the path in `x-sme-path` for every /app request; it
 * is judged by safeRedirectPath again here (the header is ours, but a path is only ever used if it is a plain same-site one). With no request around (a test) or no usable path it is plain /login.
 */
async function loginTarget(): Promise<string> {
  try {
    const path = (await headers()).get("x-sme-path");
    if (path && path !== "/login") {
      const safe = safeRedirectPath(path, "");
      if (safe) return `/login?next=${encodeURIComponent(safe)}`;
    }
  } catch {
    // not in a request: plain /login
  }
  return "/login";
}

async function load(strict: boolean): Promise<AuthenticatedUser> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(await loginTarget());

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) redirect(await loginTarget());

  const factors = (data.user.factors ?? []) as Factor[];
  const hasSecondFactor = factors.some(
    (f) => f.status === "verified" && f.factor_type === "totp",
  );
  // Read from the token getUser() has just validated. If the level cannot be read it counts as aal1 (fail closed).
  const level = await supabase.auth.mfa
    .getAuthenticatorAssuranceLevel()
    .then((r) => r.data?.currentLevel ?? null)
    .catch(() => null);
  const aal = level === "aal2" ? "aal2" : "aal1";

  // A person who HAS an authenticator must use it: a password-only session never reaches the app. (The proxy does the same
  // optimistically; this is the check that counts.) The challenge page itself loads with strict = false.
  if (strict && hasSecondFactor && aal !== "aal2") redirect("/auth/mfa");

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    accessToken,
    aal,
    hasSecondFactor,
  };
}

/**
 * Data-access-layer gate for Server Components and Server Actions.
 *
 * Identity comes from `auth.getUser()`, which asks the Supabase Auth server to validate the token.
 * `auth.getSession()` only reads the cookie without verifying anything, so it is NEVER used to
 * decide who the caller is. It is called after `getUser()` has succeeded, and only to obtain the
 * access token to forward to the API (which re-verifies the signature, issuer and audience).
 */
export const requireUser = cache(() => load(true));

/** The same gate for the pages a password-only session must be able to reach: the authenticator challenge and enrolment. */
export const requireUserBeforeSecondFactor = cache(() => load(false));
