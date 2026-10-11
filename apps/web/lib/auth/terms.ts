import { LEGAL_VERSION } from "@/lib/legal/version";

/**
 * The version of the terms a person accepts when they sign up. It is sent with the sign-up and the database records it, with its own clock,
 * when the account is made (public.terms_acceptances). It is the version of the Terms and the Privacy Policy pages (lib/legal/version.ts), draft until they are reviewed
 * (docs/pre-pilot-checklist.md): a new text means a new version here, never an edit under the same name.
 */
export const TERMS_VERSION = LEGAL_VERSION;
