import type { Lang } from "@/i18n/lang";

/**
 * The shapes the sign-up and set-up screens call (Job AC contract: `signUp({ name, email, password, businessName, acceptTerms })` and `completeSetup({ businessType, language })`,
 * server actions by Claude 1, Job AD). The result and the error codes below are OUR reading of them (the contract names the inputs only): a failure is `{ ok: false, error: <code> }`
 * and the screens know the codes in SIGNUP_ERRORS; any other code gets the generic sentence. If the real result differs, change THIS file and the two lines that pass the action.
 */
export type SignUpInput = { name: string; email: string; password: string; businessName: string; acceptTerms: boolean };
export type CompleteSetupInput = { businessType: string; language: Lang };
export type ActionResult = { ok: true } | { ok: false; error: string };
export type SignUpAction = (input: SignUpInput) => Promise<ActionResult>;
export type CompleteSetupAction = (input: CompleteSetupInput) => Promise<ActionResult>;

/** The error codes a sign-up can answer with, each with the word key of its sentence. */
export const SIGNUP_ERRORS = ["email_taken", "weak_password", "invalid_email", "required", "terms", "rate_limited"] as const;
/** The kinds of business offered at set-up (the value is what `completeSetup` receives). */
export const BUSINESS_TYPES = ["wholesaler", "manufacturer", "trader", "retailer", "other"] as const;
