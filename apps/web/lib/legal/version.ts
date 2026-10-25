/**
 * The version of the Terms of Use AND the Privacy Policy (one number for both: they are accepted together at sign-up, and the database records one `terms_version`
 * with the time, `public.terms_acceptances`). A new text means a new version here, never an edit under the same name. Format of the database: `^[a-z0-9][a-z0-9.-]{0,29}$`.
 * Job DM (2026-10-25): the free trial is 14 days, counted from the day the workspace's WhatsApp is connected (owner decision of 25 October); the Terms text and its summary say so.
 * Job DB (2026-10-24): the texts were rewritten from the owner's facts (Stack19, Mumbai hosting, the four addresses, the trial). Job DD (2026-10-24.2): the response times became two, 7 days to access, correct or erase and 30 days for any other grievance.
 */
export const LEGAL_VERSION = "2026-10-25";

/** The day the texts were last changed, shown on every legal page as "Last updated". Moves together with LEGAL_VERSION. ISO date. */
export const LEGAL_UPDATED = "2026-10-25";

/**
 * While true, the legal pages show a "Draft, pending legal review" banner. Job DB: the owner asked for the pages to carry no such line (Meta and Google read them), so it is false; "pending lawyer review" is said in the report
 * of the job, and the DPDP legal review is still the owner's to commission (docs/pre-pilot-checklist.md). Setting it back to true brings the banner back everywhere; nothing else needs to change.
 */
export const LEGAL_IS_DRAFT = false;
