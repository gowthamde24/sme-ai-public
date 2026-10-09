import type { BusinessType, SetupLanguage } from "./account";

/**
 * The types of the sign-up and first-login setup server actions (job AD / D2), exported here so the screens import them instead of guessing.
 * Types and constants only: nothing in this file calls the network. The actions are `signUp` (app/signup/actions.ts) and `completeSetup`
 * (app/app/setup/actions.ts).
 */
export type { BusinessType, SetupLanguage } from "./account";
export { BUSINESS_TYPES, SETUP_LANGUAGES } from "./account";

/** Exactly these five, in this order. */
export const SIGNUP_ERRORS = ["email_taken", "weak_password", "terms_required", "too_many_signups", "invalid"] as const;
export type SignUpError = (typeof SIGNUP_ERRORS)[number];

export type SignUpInput = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  acceptTerms: boolean;
};

export type SignUpResult = { ok: true; next: "check-email" } | { ok: false; error: SignUpError };

export type CompleteSetupInput = { businessType: BusinessType; language: SetupLanguage };
export type CompleteSetupResult = { ok: true } | { ok: false; error: string };
