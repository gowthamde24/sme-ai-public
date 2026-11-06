import type { CustomerFilter } from "@/components/v2/app/customer/CustomerView";
import type { LeadProfile } from "@/lib/lead-desk/profile";
import type { TimelineItem } from "@/lib/api/customer-timeline";

/**
 * The customer page's plain-words parts (app v4 part 3), pure so they are tested without a server: the status (one short phrase), What they want (only the fields the profile has), the ONE main button and where each timeline row
 * opens. Nothing is guessed: a quote waiting for the owner's OK is a quote in the timeline whose status is "draft"; "Hot" is the profile's own urgency; "Quiet" is the newest row's age.
 */
export const FILTERS: readonly CustomerFilter[] = ["all", "call", "message", "quote", "visit", "order", "follow_up"];
export const asFilter = (v: string | undefined): CustomerFilter => ((FILTERS as readonly string[]).includes(v ?? "") ? (v as CustomerFilter) : "all");

const DAY = 86_400_000;
export const QUIET_DAYS = 7;

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
