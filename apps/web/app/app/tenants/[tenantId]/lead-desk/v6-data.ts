import { shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";
import { ApiAuthError } from "@/lib/api/client";
import { listProspects, readAvailability } from "@/lib/api/lead-finder";
import { listVisits } from "@/lib/api/visits";
import { applyFilter, NO_FILTER, type DeskLead } from "@/lib/lead-desk/leads";
import { readDeskLeads, readTouches, type Ctx } from "@/lib/lead-desk/leads-source";
import { finderAccess, type Prospect } from "@/lib/lead-finder/types";
import type { LeadSignals } from "@/lib/leads-v6/chips";
import { rowFromLead, rowFromProspect, signalsFromVisits, sortRows, type LeadRow } from "@/lib/leads-v6/rows";
import type { Handoff } from "@/lib/outreach/types";
import { readEntitlements } from "@/lib/plan/tier-source";
import { leadsScreens } from "@/lib/screens/flag";

/**
 * The reads of the design-system-v6 Leads page: Lead Desk's leads (one page), the chips a visit tells (visits of the last 45 and the next 16 days), and the businesses the Lead Finder found nearby (the first page, where the Lead Finder is
 * on for this workspace). A part that cannot be read leaves its rows out; only a rejected session is thrown. `mock` (LEADS_SCREENS=mock) gives made-up signals and two made-up businesses found nearby. SERVER ONLY.
 */
export type LeadsRead = { rows: LeadRow[]; nextCursor: string | null; unavailable: boolean; mock: boolean };

/** Made-up chips for the test screens: the third lead has a visit, the fourth a quote, the sixth is won. */
export function mockSignals(leads: readonly DeskLead[]): Map<string, LeadSignals> {
  const at = (i: number): string | undefined => leads[i]?.id;
  const out = new Map<string, LeadSignals>();
  const put = (i: number, s: LeadSignals) => {
    const id = at(i);
    if (id) out.set(id, s);
  };
  put(2, { visitBooked: true });
  put(3, { visitBooked: true, quoted: true });
  put(5, { visitBooked: true, quoted: true, won: true });
  return out;
}

const MOCK_FOUND: Prospect[] = [
  { id: "00000000-0000-4000-8000-000000000201", name: "Sri Sai Constructions (made up)", category: "contractor", area: "Jayanagar", status: "needs_owner" },
  { id: "00000000-0000-4000-8000-000000000202", name: "Lakshmi Tiles and Sanitary (made up)", category: "retailer", area: "Gandhi Nagar", status: "contacted" },
].map((p, i) => ({ ...p, phone: null, createdAt: new Date(Date.UTC(2026, 10, 12 - i, 6)).toISOString() }) as unknown as Prospect);

async function foundRows(token: string, tenantId: string, unavailable: string): Promise<LeadRow[]> {
  if (leadsScreens() === "mock") return MOCK_FOUND.map((p) => rowFromProspect(p, unavailable));
  try {
    const [availability, entitlements] = await Promise.all([readAvailability(token, tenantId), readEntitlements(token, tenantId)]);
    if (finderAccess(availability, entitlements.features.leadFinder) !== "on") return [];
    const page = await listProspects(token, tenantId, { limit: 25 });
    return page.items.map((p) => rowFromProspect(p, unavailable));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return [];
  }
}

export async function readLeadsV6(ctx: Ctx, o: { handoffs: readonly Handoff[] | null; after: string | null; q: string; now: Date; newEnquiry: string; unavailable: string }): Promise<LeadsRead> {
  const mock = leadsScreens() === "mock";
  const filter = { ...NO_FILTER, q: o.q };
  const page = await readDeskLeads(ctx, o.handoffs, o.after, o.now, filter);
  if (page === null) return { rows: [], nextCursor: null, unavailable: true, mock };
  const leads = applyFilter(page.leads, filter, ctx.userId);
  let signals = new Map<string, LeadSignals>();
  if (mock) signals = mockSignals(page.leads);
  else {
    try {
      const today = todayInIndia(o.now.getTime());
      signals = signalsFromVisits((await listVisits(ctx.token, ctx.tenantId, { from: shiftDay(today, -45), to: shiftDay(today, 16) })).items);
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
    }
  }
  const leadRows = leads.map((l) => rowFromLead(l, signals.get(l.id) ?? {}, o.newEnquiry));
  const found = o.after === null ? await foundRows(ctx.token, ctx.tenantId, o.unavailable) : [];
  const q = o.q.toLowerCase();
  const foundShown = q === "" ? found : found.filter((r) => `${r.name} ${r.line}`.toLowerCase().includes(q));
  return { rows: sortRows([...leadRows, ...foundShown]), nextCursor: page.nextCursor, unavailable: false, mock };
}

export { readTouches };
