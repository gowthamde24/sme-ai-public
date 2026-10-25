import { CATEGORIES_OF, isCategory, isResult, type Outcome, type OutcomeCategory, type OutcomeResult, type OutcomeTotals } from "./types";

/**
 * The FAKE outcomes of the screens (job DM), only for OUTCOME_SCREENS=mock: invented, the same for the same customer, no network and nothing stored on a server. What an owner corrects is kept in ONE small cookie (at most CAP
 * corrections, read with allow-lists: nothing in it is trusted). It stands in for C1's API (contract-outcomes.md) until that exists.
 */
export const MOCK_COOKIE = "sme_outcome_mock";
const CAP = 12;
type Correction = [OutcomeResult, OutcomeCategory];
export type Corrections = Record<string, Correction>;

const ID = /^[a-z0-9-]{1,40}$/;
export function parseCorrections(raw: string | undefined): Corrections {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Corrections = {};
    for (const [id, c] of Object.entries(v).slice(0, CAP)) if (ID.test(id) && Array.isArray(c) && isResult(c[0]) && isCategory(c[1]) && CATEGORIES_OF[c[0]].includes(c[1])) out[id] = [c[0], c[1]];
    return out;
  } catch {
    return {};
  }
}
export const encodeCorrections = (c: Corrections): string => JSON.stringify(Object.fromEntries(Object.entries(c).slice(-CAP)));

const HOUR = 3_600_000;
/** Four invented outcomes, newest first, with the reason the AI would write. They carry no name and no number. */
const TEMPLATES: readonly { channel: Outcome["channel"]; ago: number; result: OutcomeResult; category: OutcomeCategory; reason: string }[] = [
  { channel: "call", ago: 2, result: "positive", category: "visit_booked", reason: "Asked about the new designs and agreed to visit the shop on Saturday at 11:00." },
  { channel: "whatsapp", ago: 20, result: "negative", category: "too_costly", reason: "Liked the photos but said the price is above the budget." },
  { channel: "call", ago: 50, result: "unclear", category: "call_back_later", reason: "Was travelling and asked to be called again next week." },
  { channel: "whatsapp", ago: 100, result: "positive", category: "order_likely", reason: "Asked for the quote to be sent again and said the order is likely this month." },
];

const hash = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

/** The outcomes of one customer: three or four of the invented ones, the same for the same customer, with the owner's corrections laid over them. */
export function mockOutcomes(leadId: string, now: Date, corrections: Corrections = {}): Outcome[] {
  const start = hash(leadId) % 2;
  return TEMPLATES.slice(start, start + 3 + (hash(leadId) % 2 === 0 ? 1 : 0)).map((t, i) => {
    const id = `m${hash(leadId) % 100000}-${i}`;
    const fix = corrections[id];
    return { id, channel: t.channel, at: new Date(now.getTime() - t.ago * HOUR).toISOString(), result: fix ? fix[0] : t.result, category: fix ? fix[1] : t.category, reason: t.reason, corrected: Boolean(fix) };
  });
}

/** Today's totals of the invented day. */
export const mockTotals = (): OutcomeTotals => ({ positive: 7, negative: 3, unclear: 2, notInterested: 3 });
