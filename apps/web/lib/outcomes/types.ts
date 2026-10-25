/**
 * What happened after a call or a WhatsApp follow-up (job DM). The AI records the outcome (positive, negative or unclear), a short reason and a category; the owner can correct it. These are the shapes the screens read; the API
 * that fills them is C1's (docs/contracts/outcomes.md): OUTCOME_SCREENS=1 reads it (lib/api/outcomes.ts), =mock reads FAKE data and says "Not available yet" when a read fails. A reason is one line of words: it holds no child's
 * name and no phone number (the API's rule); the screens draw it as plain text, never as markup.
 */
export const RESULTS = ["positive", "negative", "unclear"] as const;
export type OutcomeResult = (typeof RESULTS)[number];
export const CATEGORIES = ["interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later"] as const;
export type OutcomeCategory = (typeof CATEGORIES)[number];
export const CHANNELS = ["call", "whatsapp"] as const;
export type OutcomeChannel = (typeof CHANNELS)[number];

export type Outcome = { id: string; channel: OutcomeChannel; /** ISO 8601. */ at: string; result: OutcomeResult; /** null: unclear, the AI could not tell what kind (the API's own word for it). */ category: OutcomeCategory | null; /** null: none was given (always so for a school: no child data; the screen draws the category's fixed words). */ reason: string | null; /** The owner changed what the AI recorded. */ corrected: boolean };
/** The day's counts. `notInterested` is the one kind of negative outcome the line names; the other negative ones (wrong number, too costly) are `negative - notInterested`. */
export type OutcomeTotals = { positive: number; negative: number; unclear: number; notInterested: number };

/** What a read says: the flag is off (nothing is drawn), the API cannot answer (the part says "Not available yet"), or the data. */
export type Read<T> = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: T };
export type CtxOutcomes = { token: string; tenantId: string };

export const isResult = (v: unknown): v is OutcomeResult => typeof v === "string" && (RESULTS as readonly string[]).includes(v);
/** "No category": what an unclear outcome may carry instead of `call_back_later`; the API's `null`. */
export const NO_CATEGORY = "none";
export const isCategory = (v: unknown): v is OutcomeCategory => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
/** A category that makes sense for a result: a positive outcome is interested, visit booked or order likely; a negative one is not interested, wrong number or too costly; "call back later" is unclear. */
export const CATEGORIES_OF: Record<OutcomeResult, readonly OutcomeCategory[]> = { positive: ["interested", "visit_booked", "order_likely"], negative: ["not_interested", "wrong_number", "too_costly"], unclear: ["call_back_later"] };
