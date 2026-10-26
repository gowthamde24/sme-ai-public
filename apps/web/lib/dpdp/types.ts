/**
 * What the DPDP screens read and send (job DQ part 2; contract-dpdp.md): the consent record of a signed-in person, the grievance a person raises, and the public facts of the notice (its version, the companies that process data,
 * the retention numbers). Pure types and the closed lists the forms use; the readers are in lib/api/dpdp.ts.
 */
export const GRIEVANCE_KINDS = ["access", "correction", "erasure", "withdraw_consent", "complaint", "other"] as const;
export type GrievanceKind = (typeof GRIEVANCE_KINDS)[number];
export const MARKETING_STATES = ["not_given", "given", "withdrawn"] as const;
export type MarketingState = (typeof MARKETING_STATES)[number];
/** How a consent was given: at sign-up (e-mail, Facebook), through Google, or in Settings. */
export const CONSENT_VIAS = ["signup", "google", "settings"] as const;
export type ConsentVia = (typeof CONSENT_VIAS)[number];

export type ConsentHistoryRow = { action: "given" | "withdrawn"; at: string; via: string; noticeVersion: string };
export type Consents = {
  noticeVersion: string;
  marketing: { state: MarketingState; since: string | null };
  history: ConsentHistoryRow[];
};

export type GrievanceInput = { name: string; contact: string; kind: GrievanceKind; details: string; language: "en" | "te" | "hi" | "kn" };
export type GrievanceError = "name" | "contact" | "rate" | "invalid" | "down";
export type GrievanceResult = { ok: true; reference: string; answerDueOn: string; answerWithinDays: number } | { ok: false; error: GrievanceError };
export type MarketingResult = { ok: true; consents: Consents } | { ok: false; error: "down" | "forbidden" };

export type PrivacyNotice = {
  privacyVersion: string;
  termsVersion: string;
  privacyEmail: string;
  helloEmail: string;
  grievance: { answerWithinDays: number };
  retention: { lapsedReadOnlyDays: number; erasureWarningHours: number; accountDeletionCancelDays: number; securityLogDays: number };
};
export type Subprocessor = { id: string; name: string; purpose: string; country: string; data: string; link: string | null };
export type Subprocessors = { version: string; updatedOn: string; draft: boolean; items: Subprocessor[] };

export const MAX_GRIEVANCE_NAME = 120;
export const MAX_GRIEVANCE_CONTACT = 200;
export const MAX_GRIEVANCE_DETAILS = 4000;
