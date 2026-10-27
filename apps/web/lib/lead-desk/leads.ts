import { SOURCE_TAGS } from "@/lib/outreach/types";

/**
 * The leads of Lead Desk (night 4, part A6): who arrived, from where, in what state, who it is handed to, and whether it is HOT (somebody showed interest and nobody has called back). A lead is the CRM's lead (`GET /leads`) with the name of its
 * contact; the source is the exact tag the imports and live sources write (`leads.source`). Pure types, the filter of the list and the test data: no request, no cookie.
 */
export const LEAD_STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type DeskLead = { id: string; contactId: string | null; name: string; source: string | null; status: LeadStatus; ownerUserId: string | null; createdAt: string; hot: boolean };
export type DeskFilter = { source: string | null; status: LeadStatus | null; mine: boolean; hot: boolean };
export const NO_FILTER: DeskFilter = { source: null, status: null, mine: false, hot: false };

/** The filter out of the address: only known words count; anything else is "no filter" for that part. */
export function parseFilter(query: Record<string, string | string[] | undefined>): DeskFilter {
  const one = (k: string): string | undefined => (Array.isArray(query[k]) ? (query[k] as string[])[0] : (query[k] as string | undefined));
  const source = one("source");
  const status = one("status");
  return {
    source: source && (SOURCE_TAGS as readonly string[]).includes(source) ? source : null,
    status: status && (LEAD_STATUSES as readonly string[]).includes(status) ? (status as LeadStatus) : null,
    mine: one("mine") === "1",
    hot: one("hot") === "1",
  };
}

export function applyFilter(leads: readonly DeskLead[], f: DeskFilter, userId: string): DeskLead[] {
  return leads.filter((l) => (f.source === null || l.source === f.source) && (f.status === null || l.status === f.status) && (!f.mine || l.ownerUserId === userId) && (!f.hot || l.hot));
}

/** The address of the list with a filter (empty parts left out). */
export function filterHref(base: string, f: DeskFilter): string {
  const p = new URLSearchParams();
  if (f.source) p.set("source", f.source);
  if (f.status) p.set("status", f.status);
  if (f.mine) p.set("mine", "1");
  if (f.hot) p.set("hot", "1");
  const q = p.toString();
  return q ? `${base}/lead-desk?${q}` : `${base}/lead-desk`;
}

const NAMES = ["Ravi K.", "Anitha R.", "Kiran P.", "Lakshmi S.", "Suresh B.", "Meena V.", "Arjun T.", "Divya M.", "Harish N.", "Padma G.", "Venkat L.", "Sunita D.", "Mahesh C.", "Revathi J."];
const SOURCES = ["meta_lead_ads", "indiamart", "website_form", "excel_upload", "justdial", "meta_lead_ads", "website_form"];
const STATUSES: LeadStatus[] = ["new", "new", "contacted", "qualified", "new", "contacted", "disqualified"];

/** Fourteen made-up leads for the test screens (LEADS_SCREENS=mock): the same each day. `assigned` = what the person assigned in this browser; the first two names are the hot ones of the hand-off list. */
export function mockLeads(now: Date, assigned: Readonly<Record<string, string | null>>, hotNames: readonly string[], userId: string): DeskLead[] {
  return NAMES.map((name, i) => {
    const id = `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`;
    return { id, contactId: null, name, source: SOURCES[i % SOURCES.length], status: STATUSES[i % STATUSES.length], ownerUserId: id in assigned ? assigned[id] : i % 3 === 0 ? userId : null, createdAt: new Date(now.getTime() - i * 5 * 3_600_000).toISOString(), hot: hotNames.includes(name) };
  });
}
