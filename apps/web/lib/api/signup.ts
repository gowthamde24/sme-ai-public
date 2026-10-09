import type { BusinessType, SetupLanguage } from "./account";

/**
 * The types of the sign-up and first-login setup server actions (job AD / D2), exported here so the screens import them instead of guessing.
 * Types and constants only: nothing in this file calls the network. The actions are `signUp` (app/signup/actions.ts) and `completeSetup`
 * (app/app/setup/actions.ts).
 */
export type { BusinessType, SetupLanguage } from "./account";
export { BUSINESS_TYPES, SETUP_LANGUAGES } from "./account";

/**
 * Exactly these four, in this order. There is no "email taken": a sign-up with an address that already has an account answers
 * `{ ok: true, next: "check-email" }` like any other, so nobody can learn which addresses have accounts (ADR 0003).
 */
export const SIGNUP_ERRORS = ["weak_password", "terms_required", "too_many_signups", "invalid"] as const;
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
