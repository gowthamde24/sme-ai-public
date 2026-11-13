import { formatRupeesShort } from "@/lib/money";

import type { NeedsCard } from "../types";
import { weightOf } from "../types";

/**
 * Today's top band, the data (design system v6, owner 13 Nov 2026). Pure: no fetch, no React. Everything here is built from what Today already reads (the cards that wait, the store's visits, the new leads count); a number that cannot be read is
 * null and the band leaves that piece out, never a made-up figure. The estimates ("about 40 min", "about ₹180") come from `estimateJob`, a MOCK with the shape of C1's `POST /billing/estimate` until that route exists.
 */

/** What C1's `POST /billing/estimate {calls, avg_minutes}` answers (docs: billing v2): the cost and the time of a job in words. Money is ₹ at the plan's rate. */
export type Estimate = { costText: string; timeText: string; totalMinutes: number };

/** The per-minute rate of the pay-as-you-go plan, in paise (₹4.50 a minute; C1's `GET /v1/pricing` `rate_text`). MOCK: the real estimate comes from the API. */
export const MOCK_RATE_PAISE_PER_MINUTE = 450;

const minutesText = (minutes: number): string => {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `about ${h} h` : `about ${h} h ${r} min`;
};

/** MOCK of `POST /billing/estimate`: `calls` people at `avgMinutes` each. */
export function estimateJob({ calls, avgMinutes }: { calls: number; avgMinutes: number }): Estimate {
  const total = Math.max(0, Math.round(calls * avgMinutes));
  return { costText: `about ${formatRupeesShort(Math.round(total * MOCK_RATE_PAISE_PER_MINUTE))}`, timeText: minutesText(total), totalMinutes: total };
}

/** The pieces of the one line under the greeting: enquiries, visits booked, ₹ in quotes. A piece that is null is not said. */
export type BandFacts = { enquiries: number | null; visits: number | null; quotesPaise: number | null };
export type LinePiece = { key: "enq" | "visits" | "quotes"; n: number; amount?: string };

export function linePieces(f: BandFacts): LinePiece[] {
  const out: LinePiece[] = [];
  if (f.enquiries !== null && f.enquiries >= 0) out.push({ key: "enq", n: f.enquiries });
  if (f.visits !== null && f.visits >= 0) out.push({ key: "visits", n: f.visits });
  if (f.quotesPaise !== null && f.quotesPaise > 0) out.push({ key: "quotes", n: 1, amount: formatRupeesShort(f.quotesPaise) });
  return out;
}

/** The ₹ of the quotes waiting for the OK (the cards' own amounts); null when no quote card has an amount (nothing is guessed). */
export function quotesPaiseOf(needs: readonly NeedsCard[] | null): number | null {
  if (!needs) return null;
  let sum = 0;
  let any = false;
  for (const c of needs) {
    if (c.type !== "item") continue;
    if ((c.item.kind === "quote_approval" || c.item.kind === "material_quote_approval") && typeof c.item.amount_paise === "number") {
      sum += c.item.amount_paise;
      any = true;
    }
  }
  return any ? sum : null;
}

/** A suggested job. `n` is how many people or things; `est` is the estimate of a calling job (null for a job that makes no calls); `amountPaise` the ₹ a quote job is about. */
export type Suggestion = { id: "followups" | "leads" | "quotes"; n: number; est: Estimate | null; amountPaise: number | null };

const countOf = (needs: readonly NeedsCard[] | null, kinds: readonly string[]): number =>
  (needs ?? []).reduce((sum, c) => (c.type === "item" && kinds.includes(c.item.kind) ? sum + weightOf(c) : sum), 0);

/** The most calls one suggestion offers at once (a plan card still asks the owner's OK, and the plan says the calling hours). */
const MAX_CALLS = 20;

/**
 * Two or three jobs from the business's own data, each with its time and ₹ (an estimate) and one button: the follow-ups that are due, the new enquiries nobody called yet, the quotes that wait. A job with nothing to do is not offered;
 * with nothing at all the row is not drawn.
 */
export function deriveSuggestions({ needs, newLeads }: { needs: readonly NeedsCard[] | null; newLeads: number | null }): Suggestion[] {
  const out: Suggestion[] = [];
  const due = countOf(needs, ["followup_due", "callback_due"]);
  if (due > 0) out.push({ id: "followups", n: due, est: estimateJob({ calls: Math.min(due, MAX_CALLS), avgMinutes: 2 }), amountPaise: null });
  if (newLeads !== null && newLeads > 0) out.push({ id: "leads", n: newLeads, est: estimateJob({ calls: Math.min(newLeads, MAX_CALLS), avgMinutes: 2 }), amountPaise: null });
  const quotes = countOf(needs, ["quote_approval", "material_quote_approval"]);
  if (quotes > 0) out.push({ id: "quotes", n: quotes, est: null, amountPaise: quotesPaiseOf(needs) });
  return out.slice(0, 3);
}

/** The example instructions the command bar cycles through as its placeholder (real things the assistant does). */
export const PLACEHOLDER_KEYS = ["tv6.ph.1", "tv6.ph.2", "tv6.ph.3", "tv6.ph.4"] as const;
/** The four chips: each prefills the input with the start of an instruction. */
export const CHIPS = [
  { id: "call", label: "tv6.chip.call", fill: "tv6.chip.call.fill" },
  { id: "whatsapp", label: "tv6.chip.wa", fill: "tv6.chip.wa.fill" },
  { id: "quote", label: "tv6.chip.quote", fill: "tv6.chip.quote.fill" },
  { id: "find", label: "tv6.chip.find", fill: "tv6.chip.find.fill" },
] as const;

/**
 * A phone number made safe to show: the country code and the last three digits only ("+91 ••••• ••421"). The full number is NEVER drawn on Today. Anything that is not a number of at least 7 digits gives null (nothing is shown).
 */
export function maskNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const cc = raw.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10 > 0 ? digits.length - 10 : 2)}` : "+91";
  return `${cc} ••••• ••${digits.slice(-3)}`;
}

/** The daily headline of the phone: how many things need the person (null count = not known: no headline). */
export function headlineKey(waiting: number | null): { key: "tv6.head.none" | "tv6.head.one" | "tv6.head.other"; n: number } | null {
  if (waiting === null) return null;
  return waiting === 0 ? { key: "tv6.head.none", n: 0 } : { key: waiting === 1 ? "tv6.head.one" : "tv6.head.other", n: waiting };
}
