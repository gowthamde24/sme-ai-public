import { SOURCE_TAGS } from "@/lib/outreach/types";

import { URGENCIES, type LeadProfile, type Urgency } from "./profile";

/**
 * The leads of Lead Desk (night 4, part A6): who arrived, from where, in what state, who it is handed to, and whether it is HOT (somebody showed interest and nobody has called back). A lead is the CRM's lead (`GET /leads`) with the name of its
 * contact; the source is the exact tag the imports and live sources write (`leads.source`). Pure types, the filter of the list and the test data: no request, no cookie.
 */
export const LEAD_STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type DeskLead = { id: string; contactId: string | null; name: string; source: string | null; status: LeadStatus; ownerUserId: string | null; createdAt: string; hot: boolean; /** What the lead is (need, size, area, urgency...), from the API's normaliser; absent when it has none. */ profile?: LeadProfile | null; /** Not yet opened by this person. */ isNew?: boolean };
export type DeskFilter = { source: string | null; status: LeadStatus | null; mine: boolean; hot: boolean; urgency: Urgency | null; junk: boolean; q: string };
export const NO_FILTER: DeskFilter = { source: null, status: null, mine: false, hot: false, urgency: null, junk: false, q: "" };

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
    urgency: (URGENCIES as readonly unknown[]).includes(one("urgency")) ? (one("urgency") as Urgency) : null,
    junk: one("junk") === "1",
    q: (one("q") ?? "").trim().slice(0, 80),
  };
}

export function applyFilter(leads: readonly DeskLead[], f: DeskFilter, userId: string): DeskLead[] {
  const q = f.q.toLowerCase();
  const said = (l: DeskLead) => [l.name, l.profile?.need, l.profile?.area, l.profile?.city, l.profile?.originalText].filter(Boolean).join(" ").toLowerCase();
  // junk is flagged, never deleted: it stays out of the list until the person asks for it
  return leads.filter((l) => (f.source === null || l.source === f.source) && (f.status === null || l.status === f.status) && (!f.mine || l.ownerUserId === userId) && (!f.hot || l.hot) && (f.urgency === null || l.profile?.urgency === f.urgency) && (f.junk || !l.profile?.junk) && (q === "" || said(l).includes(q)));
}

/** The address of the list with a filter (empty parts left out). */
export function filterHref(base: string, f: DeskFilter): string {
  const p = new URLSearchParams();
  if (f.source) p.set("source", f.source);
  if (f.status) p.set("status", f.status);
  if (f.mine) p.set("mine", "1");
  if (f.hot) p.set("hot", "1");
  if (f.urgency) p.set("urgency", f.urgency);
  if (f.junk) p.set("junk", "1");
  if (f.q) p.set("q", f.q);
  const q = p.toString();
  return q ? `${base}/lead-desk?${q}` : `${base}/lead-desk`;
}

const NAMES = ["Ravi K.", "Anitha R.", "Kiran P.", "Lakshmi S.", "Suresh B.", "Meena V.", "Arjun T.", "Divya M.", "Harish N.", "Padma G.", "Venkat L.", "Sunita D.", "Mahesh C.", "Revathi J."];
const SOURCES = ["meta_lead_ads", "indiamart", "website_form", "excel_upload", "justdial", "meta_lead_ads", "website_form"];
const STATUSES: LeadStatus[] = ["new", "new", "contacted", "qualified", "new", "contacted", "disqualified"];

const P = (o: Partial<LeadProfile>): LeadProfile => ({ need: null, quantity: null, area: null, city: null, budget: null, timeline: null, urgency: null, campaign: null, originalText: null, guessed: [], duplicateOf: null, mergedCount: 0, junk: null, ...o });
const MOCK_PROFILES: (LeadProfile | null)[] = [
  P({ need: "Paver blocks", quantity: "2000 sq ft", area: "Gandhi Nagar", urgency: "high", timeline: "This month", guessed: ["quantity"], originalText: "need pavers 2000 sqft urgent" }),
  P({ need: "Floor tiles", quantity: "800 sq ft", city: "Anantapur", urgency: "normal", budget: "Rs 60,000" }),
  P({ need: "Cement", quantity: "50 bags", area: "Kalyandurg", urgency: "low", mergedCount: 2 }),
  null,
  P({ need: "Hello", junk: "test" }),
  P({ need: "Bricks", quantity: "5000", city: "Hindupur", urgency: "high", guessed: ["need", "urgency"] }),
];

/** Fourteen made-up leads for the test screens (LEADS_SCREENS=mock): the same each day. `assigned` = what the person assigned in this browser; the first two names are the hot ones of the hand-off list. */
export function mockLeads(now: Date, assigned: Readonly<Record<string, string | null>>, hotNames: readonly string[], userId: string): DeskLead[] {
  return NAMES.map((name, i) => {
    const id = `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`;
    return { id, contactId: null, name, source: SOURCES[i % SOURCES.length], status: STATUSES[i % STATUSES.length], ownerUserId: id in assigned ? assigned[id] : i % 3 === 0 ? userId : null, createdAt: new Date(now.getTime() - i * 5 * 3_600_000).toISOString(), hot: hotNames.includes(name), profile: MOCK_PROFILES[i] ?? null, isNew: i < 2 };
  });
}
