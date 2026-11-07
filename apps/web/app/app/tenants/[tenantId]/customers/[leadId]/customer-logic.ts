import type { CustomerFilter } from "@/components/v2/app/customer/CustomerView";
import type { LeadProfile } from "@/lib/lead-desk/profile";
import type { TimelineItem } from "@/lib/api/customer-timeline";
import { formatRupeesShort } from "@/lib/money";

/**
 * The customer page's plain-words parts (app v4 part 3), pure so they are tested without a server: the status (one short phrase), What they want (only the fields the profile has), the ONE main button and where each timeline row
 * opens. Nothing is guessed: a quote waiting for the owner's OK is a quote in the timeline whose status is "draft"; "Hot" is the profile's own urgency; "Quiet" is the newest row's age.
 */
export const FILTERS: readonly CustomerFilter[] = ["all", "call", "message", "quote", "visit", "order", "follow_up"];
export const asFilter = (v: string | undefined): CustomerFilter => ((FILTERS as readonly string[]).includes(v ?? "") ? (v as CustomerFilter) : "all");

const DAY = 86_400_000;
export const QUIET_DAYS = 7;

/** The business's name for the header: a name the system made up for an enquiry ("Enquiry 92e730") says nothing, so it is left out. */
export const businessName = (name: string | null | undefined): string | null => {
  const n = (name ?? "").trim();
  return n === "" || /^(enquiry|lead|customer|contact)\s+[0-9a-f]{4,}$/i.test(n) ? null : n;
};
/** Where they came from: Lead Desk's own word for a source; a source it has no word for is said as words ("lead_finder" -> "lead finder"), never as a code. */
export const sourceWords = (code: string | null | undefined, w: Readonly<Record<string, string>>): string | null => (code ? w[`ld.source.${code}`] || code.replace(/[_-]+/g, " ").trim() || null : null);

export function waitingQuote(items: readonly TimelineItem[] | null): string | null {
  const q = items?.find((i) => i.kind === "quote" && i.target.type === "quote" && i.detail.status === "draft");
  return q ? q.target.id : null;
}

export function customerStatus(o: { items: readonly TimelineItem[] | null; urgency: string | null | undefined; leadStatus: string; now: number }, w: Readonly<Record<string, string>>): string {
  if (waitingQuote(o.items)) return w["cust.v4.status.quote"];
  if (o.urgency === "high") return w["cust.v4.status.hot"];
  const newest = o.items?.[0];
  if (newest) {
    const days = Math.floor((o.now - Date.parse(newest.at)) / DAY);
    if (days >= QUIET_DAYS) return (w[`cust.v4.status.quiet.${days === 1 ? "one" : "other"}`] ?? "").replace("{n}", days.toLocaleString("en-IN"));
  }
  if (o.leadStatus === "new") return w["cust.v4.status.new"];
  return w["cust.v4.status.active"];
}

export function customerWants(profile: LeadProfile | null | undefined,w: Readonly<Record<string, string>>): { label: string; value: string }[] {
  if (!profile) return [];
  const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 200) : null);
  const place = [clean(profile.area), clean(profile.city)].filter(Boolean).join(", ") || null;
  const rows: [string, string | null][] = [
    ["need", clean(profile.need)],
    ["quantity", clean(profile.quantity)],
    ["budget", clean(profile.budget)],
    ["timeline", clean(profile.timeline)],
    ["place", place],
  ];
  return rows.flatMap(([k, v]) => (v ? [{ label: w[`cust.v4.want.${k}`], value: v }] : []));
}

export function mainAction(o: { base: string; leadId: string; quoteId: string | null; followupDue: boolean }, w: Readonly<Record<string, string>>): { href: string; label: string } {
  if (o.quoteId) return { href: `${o.base}/quotes/${o.quoteId}`, label: w["cust.v4.main.quote"] };
  if (o.followupDue) return { href: `${o.base}/leads/${o.leadId}/followup`, label: w["cust.v4.main.followup"] };
  return { href: `${o.base}/leads/${o.leadId}`, label: w["cust.v4.main.lead"] };
}

/** Where a timeline row opens: a call (its own page, part 4), a quote, an order or the store visits of that day; the rest have no page of their own yet. */
export function timelineHref(base: string, i: TimelineItem): string | null {
  const safe = /^[0-9a-f-]{36}$/i.test(i.target.id);
  if (i.kind === "call" && i.target.type === "phone_call" && safe) return `${base}/calls/${i.target.id}`;
  if (i.kind === "quote" && i.target.type === "quote" && safe) return `${base}/quotes/${i.target.id}`;
  if (i.kind === "order" && safe) return `${base}/orders/${i.target.id}`;
  if (i.kind === "visit") return `${base}/visits`;
  return null;
}

/** Where an order stands in money words (owner, 7 Nov 2026: "paid" or "owed"), by its state. */
const ORDER_MONEY: Record<string, string> = {
  closed_paid: "paid", advance_paid: "part", in_preparation: "part", dispatched: "part", delivered: "part",
  accepted: "owed", advance_requested: "owed", quote_approved: "open", quote_sent: "open",
  declined: "declined", expired: "expired", cancelled: "cancelled",
};
/**
 * A timeline row's heading (owner, 7 Nov 2026): the kind, and for a quote or an order its amount and where it stands, "Quote · ₹48,000 · waiting for your OK", "Order · ₹1,20,000 · advance paid, rest owed"; the row's own text
 * ("Quote 3") is then not repeated. Any other row: the kind, and its text below. An amount or a state the screen does not know is left out, never guessed.
 */
export function rowHeading(i: TimelineItem, w: Readonly<Record<string, string>>): { head: string; body: string | null } {
  const kind = w[`cust.v4.kind.${i.kind}`] ?? i.kind;
  if (i.kind !== "quote" && i.kind !== "order") return { head: kind, body: i.text };
  const paise = typeof i.detail.total_paise === "number" && Number.isSafeInteger(i.detail.total_paise) && i.detail.total_paise >= 0 ? i.detail.total_paise : null;
  const status = i.kind === "quote" ? (typeof i.detail.status === "string" ? w[`cust.v4.quote.${i.detail.status}`] : undefined) : typeof i.detail.state === "string" && ORDER_MONEY[i.detail.state] ? w[`cust.v4.order.${ORDER_MONEY[i.detail.state]}`] : undefined;
  const parts = [kind, paise === null ? null : formatRupeesShort(paise), status ?? null].filter((x): x is string => !!x);
  return parts.length > 1 ? { head: parts.join(" · "), body: null } : { head: kind, body: i.text };
}
