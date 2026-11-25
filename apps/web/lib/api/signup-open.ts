import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Opening sign-up (C1; docs/contracts/signup.md, 24 Nov 2026). Off (404) unless the API's `SIGNUP_OPEN` is on: `getSignupStatus` is then null and the sign-up goes on as before. SERVER ONLY, with the person's own token. No answer carries a phone number, an
 * e-mail or a code. Every refusal is a closed word the screen draws as a plain sentence (`su.err.*`), never the API's own text.
 *   GET  /v1/signup/status                     what is still missing
 *   POST /v1/signup/consent {kind, version}    terms and privacy, before the claim
 *   POST /v1/signup/phone/start {phone}        a 6-digit code, 10 minutes, 5 tries
 *   POST /v1/signup/phone/verify {code}
 *   POST /v1/tenants/{t}/billing/trial-claim   the free credits, once per person (always 200)
 */
export type SignupStatus = { open: boolean; termsVersion: string; privacyVersion: string; emailConfirmed: boolean; emailBlocked: boolean; consentDone: boolean; phoneVerified: boolean; trialClaimed: boolean };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const VERSION = /^[a-z0-9][a-z0-9.-]{0,29}$/;

export function parseSignupStatus(json: unknown): SignupStatus {
  if (!isRec(json)) throw new ApiContractError("signup status");
  const v = (k: string): string => (typeof json[k] === "string" && VERSION.test(json[k] as string) ? (json[k] as string) : (() => { throw new ApiContractError(k); })());
  return { open: json.open === true, termsVersion: v("terms_version"), privacyVersion: v("privacy_version"), emailConfirmed: json.email_confirmed === true, emailBlocked: json.email_blocked === true, consentDone: json.consent_done === true, phoneVerified: json.phone_verified === true, trialClaimed: json.trial_claimed === true };
}

/** The status, or null when sign-up is not open (404) or cannot be read; a lost session goes on to sign-in. */
export async function getSignupStatus(token: string): Promise<SignupStatus | null> {
  try {
    return parseSignupStatus(await apiRequest("/v1/signup/status", token));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export const REASONS = ["signup_closed", "email_unconfirmed", "email_not_allowed", "rate_limited", "phone_taken", "phone_code_unavailable", "validation_error", "code_wrong", "code_expired", "code_missing", "code_locked", "version_outdated", "unavailable"] as const;
export type Reason = (typeof REASONS)[number];
export type Step = { ok: true } | { ok: false; reason: Reason; triesLeft?: number };

function refusal(error: unknown): Step {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const word = error.reason ?? error.code;
    const reason: Reason = (REASONS as readonly string[]).includes(word) ? (word as Reason) : error.status === 422 && error.code === "policy_version_outdated" ? "version_outdated" : error.status === 422 ? "validation_error" : error.status === 429 ? "rate_limited" : "unavailable";
    return { ok: false, reason };
  }
  return { ok: false, reason: "unavailable" };
}
async function post(token: string, path: string, body: unknown): Promise<Step> {
  try {
    await apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  } catch (error) {
    return refusal(error);
  }
}
export const recordConsent = (token: string, kind: "terms" | "privacy", version: string): Promise<Step> => post(token, "/v1/signup/consent", { kind, version });
export const startPhone = (token: string, phone: string): Promise<Step> => post(token, "/v1/signup/phone/start", { phone });
export const verifyPhone = (token: string, code: string): Promise<Step> => post(token, "/v1/signup/phone/verify", { code });

/** Claims the free credits for a new workspace (Owner). Always answers 200 with whether they were granted; any failure is "not granted": the workspace never waits for this. */
export async function claimTrial(token: string, tenantId: string): Promise<{ granted: boolean; reason: string | null; balancePaise: number | null }> {
  if (!isCanonicalUuid(tenantId)) return { granted: false, reason: null, balancePaise: null };
  try {
    const json = await apiRequest(`/v1/tenants/${tenantId}/billing/trial-claim`, token, { method: "POST", body: "{}" });
    if (!isRec(json)) return { granted: false, reason: null, balancePaise: null };
    return { granted: json.granted === true, reason: typeof json.reason === "string" ? json.reason : null, balancePaise: typeof json.balance_paise === "number" ? json.balance_paise : null };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { granted: false, reason: null, balancePaise: null };
  }
}
