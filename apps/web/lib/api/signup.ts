import type { BusinessType, SetupLanguage } from "./account";

/**
 * The types of the sign-up and first-login setup server actions (job AD / D2), exported here so the screens import them instead of guessing.
 * Types and constants only: nothing in this file calls the network. The actions are `signUp` (app/signup/actions.ts) and `completeSetup`
 * (app/app/setup/actions.ts).
 */
export type { BusinessType, SetupLanguage } from "./account";
export { SETUP_LANGUAGES } from "./account";

/**
 * Exactly these four, in this order. There is no "email taken": a sign-up with an address that already has an account answers
 * `{ ok: true, next: "check-email" }` like any other, so nobody can learn which addresses have accounts (ADR 0003).
 */
export const SIGNUP_ERRORS = ["weak_password", "terms_required", "too_many_signups", "invalid"] as const;
export type SignUpError = (typeof SIGNUP_ERRORS)[number];
/** What the web itself can answer besides the API's four: "closed" (job DH: public sign-up is switched off, lib/auth/signup-open.ts). Not an API code, so it is not in SIGNUP_ERRORS (the contract's list). */
export const WEB_SIGNUP_ERRORS = [...SIGNUP_ERRORS, "closed"] as const;
export type WebSignUpError = (typeof WEB_SIGNUP_ERRORS)[number];

export type SignUpInput = {
  /** Left out by the two-step sign-up (job CL): the server derives it from the address (it is asked nothing but the kind of business and how to sign in). */
  name?: string;
  email: string;
  password: string;
  /** Left out by the two-step sign-up: the business gets the pack's neutral name ("My business") until the first checklist step asks for the real one. */
  businessName?: string;
  /** The kind of business chosen on the first sign-up step (a pack id); kept with the account and used by the first-login setup. */
  businessType?: string;
  acceptTerms: boolean;
  /** The versions of the Terms and the Privacy Policy the page showed (job CF). Kept with the account and recorded, as accepted at sign-up, when the first-login setup makes the business. Left out when the page could not read them. */
  policyVersions?: { terms: string; privacy: string };
  /** The person ticked the separate, UNTICKED box for news and offers (job DQ part 2). Only `true` counts; kept in the account's metadata until the first sign-in records it with the API (PUT /v1/me/consents/marketing, via "signup"). */
  marketingOptIn?: boolean;
};

export type SignUpResult = { ok: true; next: "check-email" } | { ok: false; error: WebSignUpError };

/** `businessName` (1 to 120): the name the Owner typed at first login, saved right after the business is made. `businessLabel` (2 to 60): what an "Other" business is, in the Owner's words (only for the type that asks it). */
export type CompleteSetupInput = { businessType: BusinessType; language: SetupLanguage; businessName?: string; businessLabel?: string };
export type CompleteSetupResult = { ok: true } | { ok: false; error: string };
