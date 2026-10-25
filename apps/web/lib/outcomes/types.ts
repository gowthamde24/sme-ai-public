/**
 * What happened after a call or a WhatsApp follow-up (job DM). The AI records the outcome (positive, negative or unclear), a short reason and a category; the owner can correct it. These are the shapes the screens read; the API
 * that fills them is C1's (contract-outcomes.md, not published yet), so until it exists the screens read FAKE data behind OUTCOME_SCREENS=mock and say "Not available yet" otherwise. A reason is one line of words: it holds no child's
 * name and no phone number (the API's rule); the screens draw it as plain text, never as markup.
 */
export const RESULTS = ["positive", "negative", "unclear"] as const;
export type OutcomeResult = (typeof RESULTS)[number];
export const CATEGORIES = ["interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later"] as const;
export type OutcomeCategory = (typeof CATEGORIES)[number];
export const CHANNELS = ["call", "whatsapp"] as const;
export type OutcomeChannel = (typeof CHANNELS)[number];

export type Outcome = { id: string; channel: OutcomeChannel; /** ISO 8601. */ at: string; result: OutcomeResult; category: OutcomeCategory; reason: string; /** The owner changed what the AI recorded. */ corrected: boolean };
export type OutcomeTotals = { positive: number; negative: number; unclear: number };

/** What a read says: the flag is off (nothing is drawn), the API cannot answer (the part says "Not available yet"), or the data. */
export type Read<T> = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: T };
export type CtxOutcomes = { token: string; tenantId: string };

export const isResult = (v: unknown): v is OutcomeResult => typeof v === "string" && (RESULTS as readonly string[]).includes(v);
export const isCategory = (v: unknown): v is OutcomeCategory => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
/** A category that makes sense for a result: a positive outcome is interested, visit booked or order likely; a negative one is not interested, wrong number or too costly; "call back later" is unclear. */
export const CATEGORIES_OF: Record<OutcomeResult, readonly OutcomeCategory[]> = { positive: ["interested", "visit_booked", "order_likely"], negative: ["not_interested", "wrong_number", "too_costly"], unclear: ["call_back_later"] };
