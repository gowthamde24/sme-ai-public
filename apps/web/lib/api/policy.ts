import { apiPublicRequest, apiRequest } from "./client";
import { bad, bool, iso, list, oneOf, optStr, rec, str } from "./shape";

/**
 * The Terms and the Privacy Policy a person has accepted (job CC, screen 7; ADR 0075, the contract is in job BN's report). Each has a version, and may have an effective date; when a version changes the person is asked again.
 * With `POLICY_ENFORCE` on, every workspace route answers 403 `policy_acceptance_required` until the binding versions are accepted: `escalate` (failure.ts) sends such a person to /app/accept. Server side only, own token.
 */
export type PolicyKind = "terms" | "privacy";
export interface PolicyVersion {
  version: string;
  effective_from: string | null;
}
export interface PolicyStatus {
  current: Record<PolicyKind, PolicyVersion>;
  accepted: { kind: PolicyKind; version: string; accepted_at: string }[];
  needs: Record<PolicyKind, boolean>;
  /** The workspace routes are refused for this person right now. */
  blocking: boolean;
}
const version = (v: unknown): PolicyVersion => {
  const r = rec(v, "policy version");
  return { version: str(r.version, "version", 40), effective_from: optStr(r.effective_from, "effective_from", 40) };
};
export function parsePolicyStatus(json: unknown): PolicyStatus {
  const x = rec(json, "policy");
  const current = rec(x.current, "current");
  const needs = rec(x.needs_acceptance, "needs_acceptance");
  return {
    current: { terms: version(current.terms), privacy: version(current.privacy) },
    accepted: list(x.accepted, "accepted", 200).map((a) => {
      const r = rec(a, "accepted");
      return { kind: oneOf(r.kind, ["terms", "privacy"] as const, "kind"), version: str(r.version, "version", 40), accepted_at: iso(r.accepted_at, "accepted_at") };
    }),
    needs: { terms: bool(needs.terms, "terms"), privacy: bool(needs.privacy, "privacy") },
    blocking: x.blocking === undefined ? false : bool(x.blocking, "blocking"),
  };
}
export async function getPolicyStatus(token: string): Promise<PolicyStatus> {
  return parsePolicyStatus(await apiRequest("/v1/me/policy-acceptances", token));
}
/** Accepts the versions the person was shown (409 `policy_version_outdated` when one is no longer the current: the page reloads). */
export async function acceptPolicies(token: string, versions: { terms?: string; privacy?: string }): Promise<PolicyStatus> {
  const body: Record<string, string> = {};
  if (versions.terms) body.terms_version = versions.terms;
  if (versions.privacy) body.privacy_version = versions.privacy;
  if (Object.keys(body).length === 0) bad("nothing to accept");
  return parsePolicyStatus(await apiRequest("/v1/me/policy-acceptances", token, { method: "POST", body: JSON.stringify(body) }));
}

/** The versions an acceptance may name: the API's own pattern (letters, digits, dot, dash, underscore; 1 to 32 characters). */
export const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
export type CurrentPolicies = { terms: string; privacy: string };

/** `GET /v1/policies/current` (no sign-in): the versions in force, for the sign-up page to show and to send back. */
export function parseCurrentPolicies(json: unknown): CurrentPolicies {
  const x = rec(json, "policies");
  const v = (k: string): string => {
    const version = str(rec(x[k], k).version, `${k} version`, 32);
    return POLICY_VERSION.test(version) ? version : bad(`${k} version`);
  };
  return { terms: v("terms"), privacy: v("privacy") };
}
export async function getCurrentPolicies(): Promise<CurrentPolicies> {
  return parseCurrentPolicies(await apiPublicRequest("/v1/policies/current"));
}
