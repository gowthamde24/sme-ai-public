import type { CallDetail } from "@/lib/api/calls";
import type { TimelineItem } from "@/lib/api/customer-timeline";

/**
 * The outcome card of a call in the Calls panel (design system v6): what the call LEFT BEHIND for the owner to act on, picked from the customer's own timeline and what the call captured. Pure and checked field by field: nothing is guessed.
 * - a quote: the newest quote row of the customer's timeline. Waiting (status draft) = "Change" and "Approve"; approved = "Open in WhatsApp" (the existing redirect route of the quote; the system sends nothing).
 * - a visit: the call booked one (category visit_booked, or the visit facts the call captured, or a visit row in the timeline).
 * - a call back: the caller asked to be called later.
 * - none: nothing to act on (the card is not drawn).
 */
export type OutcomeCard =
  | { kind: "quote"; quoteId: string; type: "quote" | "material_quote"; state: "waiting" | "approved" | "other"; totalPaise: number | null }
  | { kind: "visit"; day: string | null; at: string | null }
  | { kind: "callback"; at: string | null }
  | { kind: "none" };

const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

export function outcomeCard(call: Pick<CallDetail, "category" | "captured" | "correction">, timeline: readonly TimelineItem[] | null): OutcomeCard {
  const quote = timeline?.find((i) => i.kind === "quote" && (i.target.type === "quote" || i.target.type === "material_quote") && /^[0-9a-f-]{36}$/.test(i.target.id));
  if (quote) {
    const status = quote.detail.status;
    const total = quote.detail.total_paise;
    return {
      kind: "quote",
      quoteId: quote.target.id,
      type: quote.target.type === "material_quote" ? "material_quote" : "quote",
      state: status === "draft" ? "waiting" : status === "approved" ? "approved" : "other",
      totalPaise: typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null,
    };
  }
  const facts = { ...call.captured, ...(call.correction?.captured ?? {}) };
  const visitRow = timeline?.find((i) => i.kind === "visit" && i.detail.status !== "cancelled");
  if (call.category === "visit_booked" || facts.visit_day || facts.visit_at || visitRow) {
    return { kind: "visit", day: facts.visit_day ?? null, at: iso(facts.visit_at) ?? iso(visitRow?.detail.starts_at) };
  }
  if (call.category === "call_back_later" || facts.callback_at) return { kind: "callback", at: iso(facts.callback_at) };
  return { kind: "none" };
}
