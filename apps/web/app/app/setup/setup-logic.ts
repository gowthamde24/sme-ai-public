import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { CompleteSetupInput, CompleteSetupResult } from "@/lib/api/signup";
import { PACK_CODE } from "@/lib/packs/signup";
import {
  SETUP_LANGUAGES,
  type BusinessType,
  type SetupLanguage,
  type SetupResult,
} from "@/lib/api/account";

// The input and result types live in lib/api/signup.ts so the screens import them from there.
export type { CompleteSetupInput, CompleteSetupResult } from "@/lib/api/signup";

/** Plain sentences, in the order a person would hit them. The API's own fixed sentences are passed through for a refusal it explains. */
export const SETUP_TEXT = {
  invalid: "Choose the kind of business and a language.",
  session: "Your session ended. Sign in again to finish setting up.",
  generic: "Could not finish setting up. Try again.",
} as const;

const EXPLAINED = new Set(["terms_required", "email_not_confirmed", "workspace_limit_reached", "business_type_unavailable"]);

/**
 * The first-login setup. The two choices are checked here (the shape of the business type) and again by the database (it must be one a person may choose); the business name comes from the sign-up and cannot be
 * sent from here. Idempotent: pressing twice, or doing it in a second tab, ends with the same single business and `{ ok: true }` both times.
 */
export async function runCompleteSetup(
  input: unknown,
  deps: {
    token: string;
    submit: (token: string, choices: CompleteSetupInput & { acceptedTerms?: string; acceptedPrivacy?: string }) => Promise<SetupResult>;
    /** The versions the person accepted on the sign-up page (kept with the account, job CF): recorded, as accepted at sign-up, before the business is made. */
    policies?: { terms?: string; privacy?: string };
  },
): Promise<CompleteSetupResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const businessType = typeof raw.businessType === "string" && PACK_CODE.test(raw.businessType) ? (raw.businessType as BusinessType) : null;
  const language = (SETUP_LANGUAGES as readonly unknown[]).includes(raw.language)
    ? (raw.language as SetupLanguage)
    : null;
  if (!businessType || !language) return { ok: false, error: SETUP_TEXT.invalid };
  try {
    const shown = deps.policies?.terms && deps.policies.privacy ? { acceptedTerms: deps.policies.terms, acceptedPrivacy: deps.policies.privacy } : {};
    try {
      await deps.submit(deps.token, { businessType, language, ...shown });
    } catch (error) {
      // a version changed between the sign-up page and now: the business is still made, and the accept page asks for the new version (nothing is recorded for a version the person did not see)
      if (Object.keys(shown).length > 0 && error instanceof ApiRequestError && error.code === "policy_version_outdated") await deps.submit(deps.token, { businessType, language });
      else throw error;
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: SETUP_TEXT.session };
    if (error instanceof ApiRequestError && EXPLAINED.has(error.code)) return { ok: false, error: error.message };
    return { ok: false, error: SETUP_TEXT.generic };
  }
}
