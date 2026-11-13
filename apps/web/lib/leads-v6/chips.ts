import type { Status } from "@/components/v2/app/ds/StatusPill";
import type { LeadStatus } from "@/lib/lead-desk/leads";
import type { ProspectStatus } from "@/lib/lead-finder/types";

/**
 * The six chips of the Leads page (design system v6, owner 13 Nov 2026): New, Contacted, Visit booked, Quote, Won, Lost. The CRM keeps four lead states (new, contacted, qualified, disqualified); the other three come from what
 * happened to the lead (a visit was booked, a quote was made, the visit ended in a purchase). `LeadSignals` carries that; today only visits tell it (C1 can add a `stage` to GET /leads so the quote and won steps do not depend on other lists).
 * Pure: no request, no React.
 */
export const LEAD_CHIPS = ["new", "contacted", "visit_booked", "quote", "won", "lost"] as const;
export type LeadChip = (typeof LEAD_CHIPS)[number];
export const isLeadChip = (v: unknown): v is LeadChip => typeof v === "string" && (LEAD_CHIPS as readonly string[]).includes(v);

export type LeadSignals = { visitBooked?: boolean; quoted?: boolean; won?: boolean };

/** The chip of a lead: what happened last wins (a purchase, then a quote, then a booked visit); a disqualified lead without a purchase is Lost. */
export function leadChip(status: LeadStatus, signals: LeadSignals = {}): LeadChip {
  if (signals.won) return "won";
  if (status === "disqualified") return "lost";
  if (signals.quoted) return "quote";
  if (signals.visitBooked) return "visit_booked";
  return status === "new" ? "new" : "contacted";
}

/** A business the Lead Finder found: still to be looked at = New, called or interested = Contacted, said no or skipped = Lost. */
export function prospectChip(status: ProspectStatus): LeadChip {
  if (status === "contacted" || status === "qualified") return "contacted";
  if (status === "not_interested" || status === "skipped") return "lost";
  return "new";
}

/**
 * The colour of each chip is one of the design system's six status colours (no new colours): New purple, Contacted grey, Visit booked blue, Quote orange, Won green, Lost red. The words are the page's own; the colour is never the only sign.
 */
export const CHIP_STATUS: Record<LeadChip, Status> = { new: "live", contacted: "no_answer", visit_booked: "transferred", quote: "spam", won: "completed", lost: "rejected" };

export type ChipCounts = Record<LeadChip, number> & { all: number };
export function chipCounts(rows: readonly { chip: LeadChip }[]): ChipCounts {
  const out: ChipCounts = { all: rows.length, new: 0, contacted: 0, visit_booked: 0, quote: 0, won: 0, lost: 0 };
  for (const r of rows) out[r.chip] += 1;
  return out;
}
