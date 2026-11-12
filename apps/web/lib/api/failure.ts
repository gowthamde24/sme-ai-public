import { forbidden, redirect } from "next/navigation";

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

/**
 * The codes a shop owner or staff member can really meet (plan of the error-words job, 2026-11-10), each with the string that says it. The catalog (docs/contracts/error-codes.md) has 352 codes; the rest keep the sentence of their
 * kind (above). A code that already had words on a screen of its own (the team's join codes, WhatsApp not set up, read-only, waiting for WhatsApp, a part the business type lacks) points at those words, so there is one sentence
 * per code. Money, consent, privacy and the stop list are English in every language until a person reviews them (`humanOnly` in the store). Only the sentence is kept: the API's own message never reaches the screen.
 */
export const CODE_WORDS = {
  email_not_confirmed: "apierr.code.email_not_confirmed",
  invitation_invalid: "team.err.invitation_invalid",
  invitation_locked: "team.err.invitation_locked",
  invitation_not_pending: "team.err.invitation_not_pending",
  token_expiring: "apierr.code.token_expiring",
  contact_suppressed: "apierr.code.contact_suppressed",
  customer_stopped: "apierr.code.customer_stopped",
  dnd: "apierr.code.dnd",
  no_consent: "apierr.code.no_consent",
  import_file_changed: "apierr.code.import_file_changed",
  file_too_large: "apierr.code.file_too_large",
  file_type: "apierr.code.file_type",
  unreadable_file: "apierr.code.unreadable_file",
  sheet_not_public: "apierr.code.sheet_not_public",
  plan_limit_reached: "apierr.code.plan_limit_reached",
  workspace_read_only: "apierr.read_only",
  not_in_plan: "apierr.code.not_in_plan",
  workspace_limit_reached: "apierr.code.workspace_limit_reached",
  search_cap_reached: "apierr.code.search_cap_reached",
  voice_allowance_used: "apierr.code.voice_allowance_used",
  model_busy: "apierr.code.model_busy",
  waiting_for_whatsapp: "apierr.waiting_whatsapp",
  whatsapp_not_configured: "wa.err.whatsapp_not_configured",
  whatsapp_refused: "apierr.code.whatsapp_refused",
  outside_calling_hours: "apierr.code.outside_calling_hours",
  telephony_off: "apierr.code.telephony_off",
  customer_phone_unusable: "apierr.code.customer_phone_unusable",
  call_provider_failed: "apierr.code.call_provider_failed",
  order_changed: "apierr.code.order_changed",
  quote_stale: "apierr.code.quote_stale",
  slot_full: "apierr.code.slot_full",
  photo_type_unsupported: "apierr.code.photo_type_unsupported",
  module_off: "apierr.module_off",
} as const satisfies Record<string, Parameters<AppT>[0]>;

/** The sentence of a code this file knows, else null (then the sentence of the kind is used). `Object.hasOwn`: a code called "constructor" is not a word. */
export function codeSentence(code: string | undefined, t: AppT): string | null {
  return code && Object.hasOwn(CODE_WORDS, code) ? t(CODE_WORDS[code as keyof typeof CODE_WORDS]) : null;
}

/** A failure as an answer a form can show. A rejected session redirects to sign-in. */
export function failureOf(error: unknown, t: AppT): Failure {
  if (error instanceof ApiAuthError) redirect("/login");
  const kind = kindOf(error);
  const api = error instanceof ApiRequestError ? error : null;
  const retryAfter = kind === "rate_limited" ? api?.retryAfter : undefined;
  const code = api && /^[a-z_]{1,40}$/.test(api.code) ? api.code : undefined;
  // a code with words of its own says what is true for it (a 403 `module_off` is "your kind of business does not use this part", not "your role cannot"); a second step that is missing keeps its own sentence; the rest is said by its kind
  const own = kind === "mfa" ? null : codeSentence(code, t);
  return { ok: false, kind, error: own ?? (kind === "rate_limited" ? rateSentence(t, retryAfter) : t(KEY[kind])),
 ...(kind === "mfa" ? { mfa: true } : {}), ...(retryAfter !== undefined ? { retryAfter } : {}), ...(code ? { code } : {}) };
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
    // a part the business type does not have (job CK `module_off`): the same 403 page the workspace's guard shows for a typed address (app/app/forbidden.tsx)
    if (error.status === 403 && error.code === "module_off") forbidden();
    if (error.status === 403) redirect("/app/problem/403");
    if (error.status === 429) redirect("/app/problem/429");
  }
}
