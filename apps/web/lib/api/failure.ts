import { redirect } from "next/navigation";

import type { AppT } from "@/i18n/app";

import { ApiAuthError, ApiRequestError } from "./client";

/**
 * What a refused or failed call is, in words of ours (job CC). The API's own message is never shown: the kind is chosen from its status and closed code, and the sentence comes from the string store (`apierr.*`).
 * Server side only (a rejected session goes to the sign-in page). The screens of job CC all end their server actions and their reads here, so a 403 and a 429 look the same everywhere.
 */
export type FailureKind = "forbidden" | "mfa" | "rate_limited" | "too_big" | "invalid" | "not_found" | "conflict" | "unavailable" | "other";

export interface Failure {
  ok: false;
  error: string;
  kind: FailureKind;
  /** The second step is missing: the screen offers the way to the Security page. */
  mfa?: boolean;
  /** A 429: the seconds the API asked us to wait, when it said. */
  retryAfter?: number;
  /** The API's closed code (letters and underscores only), for a screen that has a sentence of its own for it. */
  code?: string;
}

export function kindOf(error: unknown): FailureKind {
  if (!(error instanceof ApiRequestError)) return "other";
  if (error.code === "mfa_required") return "mfa";
  if (error.status === 403) return "forbidden";
  if (error.status === 429 || error.code === "rate_limited") return "rate_limited";
  if (error.status === 413 || error.code === "payload_too_large" || error.code === "file_too_large") return "too_big";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "conflict";
  if (error.status === 415 || error.status === 422) return "invalid";
  if (error.status >= 500 || error.code === "api_unreachable") return "unavailable";
  return "other";
}

const KEY: Record<FailureKind, Parameters<AppT>[0]> = {
  forbidden: "apierr.forbidden",
  mfa: "apierr.mfa",
  rate_limited: "apierr.rate",
  too_big: "apierr.too_big",
  invalid: "apierr.invalid",
  not_found: "apierr.not_found",
  conflict: "apierr.conflict",
  unavailable: "apierr.unavailable",
  other: "apierr.generic",
};

/** The sentence for a 429: with the seconds to wait when the API said (at most a few minutes are spelled out; more is "a while"). */
export function rateSentence(t: AppT, retryAfter?: number): string {
  if (retryAfter === undefined) return t("apierr.rate");
  return retryAfter <= 300 ? t("apierr.rate.n", { n: retryAfter }) : t("apierr.rate");
}

/** A failure as an answer a form can show. A rejected session redirects to sign-in. */
export function failureOf(error: unknown, t: AppT): Failure {
  if (error instanceof ApiAuthError) redirect("/login");
  const kind = kindOf(error);
  const api = error instanceof ApiRequestError ? error : null;
  const retryAfter = kind === "rate_limited" ? api?.retryAfter : undefined;
  const code = api && /^[a-z_]{1,40}$/.test(api.code) ? api.code : undefined;
  return { ok: false, kind, error: kind === "rate_limited" ? rateSentence(t, retryAfter) : t(KEY[kind]), ...(kind === "mfa" ? { mfa: true } : {}), ...(retryAfter !== undefined ? { retryAfter } : {}), ...(code ? { code } : {}) };
}

/**
 * A page that read something and failed: a rejected session goes to sign-in; a refused call (403) and a rate-limited one (429) go to the friendly pages of job BW (/app/problem/403, /429), which say one closed sentence;
 * anything else returns, and the page says what it says for that (its own "could not load" part, or the "service unreachable" page). Call it first in a `catch`.
 */
export function escalate(error: unknown): void {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    // a changed Terms or Privacy Policy that has not been accepted yet (POLICY_ENFORCE): the person is asked, not told they have no role
    if (error.status === 403 && error.code === "policy_acceptance_required") redirect("/app/accept");
    if (error.status === 403) redirect("/app/problem/403");
    if (error.status === 429) redirect("/app/problem/429");
  }
}
