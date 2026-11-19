import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { timed } from "@/lib/observe/server-timing";
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
  /** The Terms and Privacy Policy versions the person accepted on the sign-up page, kept with the account (job CF); read from what the Auth server just validated. Each is absent unless it is a well-formed version. */
  signupPolicies?: { terms?: string; privacy?: string };
  /** The kind of business chosen on the first sign-up step (job CL), kept in the account's metadata by the e-mail way. A pack id as written; the reader checks it against the packs. */
  signupPack?: string;
  /** The name the account has (the e-mail way: the one derived at sign-up; Google or Facebook: the profile's), only to fill a form the person can change. */
  displayName?: string;
  /** The person ticked the separate, unticked marketing box at sign-up (job DQ part 2): kept in the account's metadata by the e-mail way until the first sign-in records it. */
  signupMarketing?: boolean;
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

  const { data, error } = await timed("session_getuser", () => supabase.auth.getUser()); // (SERVER_TIMING=1 only: the one network call of the session check)
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

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const version = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(v) ? v : undefined);
  const signupPolicies = { terms: version(meta.accepted_terms_version), privacy: version(meta.accepted_privacy_version) };
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    accessToken,
    aal,
    hasSecondFactor,
    ...(signupPolicies.terms && signupPolicies.privacy ? { signupPolicies } : {}),
    ...(() => {
      const name = [meta.display_name, meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 100);
      return name ? { displayName: name.trim() } : {};
    })(),
    ...(meta.signup_marketing_opt_in === "1" || meta.signup_marketing_opt_in === true ? { signupMarketing: true } : {}),
    ...(typeof meta.business_type === "string" && /^[a-z][a-z0-9_]{1,30}$/.test(meta.business_type) ? { signupPack: meta.business_type } : {}),
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
export const requireUser = cache(() => timed("session", () => load(true)));

/** The same gate for the pages a password-only session must be able to reach: the authenticator challenge and enrolment. */
export const requireUserBeforeSecondFactor = cache(() => load(false));

/**
 * A fresh second-factor check for one action (the own WhatsApp messages, JOBS): the person's own authenticator code, the same challengeAndVerify as the sign-in step.
 * Returns the access token that carries the fresh level, so the API sees it. No authenticator is `no_factor` (never let through); a wrong code is `bad_code`.
 */
export type SecondStep = { ok: true; token: string } | { ok: false; reason: "no_factor" | "bad_code" };
export async function freshSecondStep(code: string): Promise<SecondStep> {
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) return { ok: false, reason: "no_factor" };
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verified.error) return { ok: false, reason: "bad_code" };
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  return token ? { ok: true, token } : { ok: false, reason: "bad_code" };
}
