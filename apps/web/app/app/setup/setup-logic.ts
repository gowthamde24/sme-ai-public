import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import {
  BUSINESS_TYPES,
  SETUP_LANGUAGES,
  type BusinessType,
  type SetupLanguage,
  type SetupResult,
} from "@/lib/api/account";

export type CompleteSetupInput = { businessType: BusinessType; language: SetupLanguage };
export type CompleteSetupResult = { ok: true } | { ok: false; error: string };

/** Plain sentences, in the order a person would hit them. The API's own fixed sentences are passed through for a refusal it explains. */
export const SETUP_TEXT = {
  invalid: "Choose the kind of business and a language.",
  session: "Your session ended. Sign in again to finish setting up.",
  generic: "Could not finish setting up. Try again.",
} as const;

const EXPLAINED = new Set(["terms_required", "email_not_confirmed", "workspace_limit_reached"]);

/**
 * The first-login setup. The two choices are checked here and again by the database; the business name comes from the sign-up and cannot be
 * sent from here. Idempotent: pressing twice, or doing it in a second tab, ends with the same single business and `{ ok: true }` both times.
 */
export async function runCompleteSetup(
  input: unknown,
  deps: {
    token: string;
    submit: (token: string, choices: CompleteSetupInput) => Promise<SetupResult>;
  },
): Promise<CompleteSetupResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const businessType = (BUSINESS_TYPES as readonly unknown[]).includes(raw.businessType)
    ? (raw.businessType as BusinessType)
    : null;
  const language = (SETUP_LANGUAGES as readonly unknown[]).includes(raw.language)
    ? (raw.language as SetupLanguage)
    : null;
  if (!businessType || !language) return { ok: false, error: SETUP_TEXT.invalid };
  try {
    await deps.submit(deps.token, { businessType, language });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: SETUP_TEXT.session };
    if (error instanceof ApiRequestError && EXPLAINED.has(error.code)) return { ok: false, error: error.message };
    return { ok: false, error: SETUP_TEXT.generic };
  }
}
