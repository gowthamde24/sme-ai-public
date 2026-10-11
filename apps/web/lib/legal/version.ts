/**
 * The version of the Terms of Use AND the Privacy Policy (one number for both: they are accepted together at sign-up, and the database records one `terms_version`
 * with the time, `public.terms_acceptances`). A new text means a new version here, never an edit under the same name. Format of the database: `^[a-z0-9][a-z0-9.-]{0,29}$`.
 */
export const LEGAL_VERSION = "draft-2026-10";

/**
 * While true, both pages show the "Draft, pending legal review" banner. The owner sets it to false only after a lawyer has read and approved the texts
 * (docs/pre-pilot-checklist.md: the DPDP review is the owner's to commission). It is the one switch: nothing else needs to change.
 */
export const LEGAL_IS_DRAFT = true;
