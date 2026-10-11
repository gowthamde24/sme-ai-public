import { ApiAuthError, apiRequest } from "@/lib/api/client";
import { fetchCompany, fetchContact, fetchLead, fetchPage, isCanonicalUuid, parsePage } from "@/lib/api/crm";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import { getSlots, getVisitSettings, listVisits, parseVisit, type Slots, type StoreSettings, type Visit } from "@/lib/api/visits";

import type { CustomerHit } from "@/components/v2/app/visits/actions-types";

/** Runs a read; a failure is null (the screen says so in that place only), except a rejected session, which sends the person to sign in. */
async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The day's visits and slots, each on its own: one that fails is null. */
export async function readDay(accessToken: string, tenantId: string, day: string): Promise<{ visits: Visit[] | null; slots: Slots | null }> {
  const [visits, slots] = await Promise.all([settle(async () => (await listVisits(accessToken, tenantId, { from: day, to: day })).items), settle(() => getSlots(accessToken, tenantId, day))]);
  return { visits, slots };
}

export const readHours = (accessToken: string, tenantId: string): Promise<StoreSettings | null> => settle(() => getVisitSettings(accessToken, tenantId));

/** One visit by id (the Ask box's link and the Today card open the Visits page at it), or null. */
export async function readVisit(accessToken: string, tenantId: string, id: string): Promise<Visit | null> {
  if (!isCanonicalUuid(id)) return null;
  return settle(async () => parseVisit(await apiRequest(`/v1/tenants/${tenantId}/visits/${id}`, accessToken)));
}

/** Who a lead is, for "Booking for ...": the contact's name, else the company's. Null if it cannot be read (the form then asks for a search). */
export async function readLeadLabel(accessToken: string, tenantId: string, leadId: string): Promise<{ leadId: string; label: string } | null> {
  if (!isCanonicalUuid(leadId)) return null;
  const lead = await settle(() => fetchLead(accessToken, tenantId, leadId));
  if (!lead) return null;
  const contactId = await settle(() => fetchLeadContactId(accessToken, tenantId, leadId));
  const [contact, company] = await Promise.all([
    contactId ? settle(() => fetchContact(accessToken, tenantId, contactId)) : Promise.resolve(null),
    lead.company_id ? settle(() => fetchCompany(accessToken, tenantId, lead.company_id as string)) : Promise.resolve(null),
  ]);
  const name = contact?.full_name?.trim() || company?.name?.trim();
  return name ? { leadId, label: name } : null;
}

const NEWEST_LEAD_PAGES = 4; // 4 x 25: the newest hundred leads

/**
 * The customers a visit can be booked for, found by NAME. Leads have no name of their own, so this looks up companies by name (the API searches those) and keeps the leads of the newest hundred that
 * belong to them. A lead older than that is not found here (it can still be booked from its own page: "Book a store visit"). At most ten answers; nothing but the name and the city comes back.
 */
export async function searchCustomers(accessToken: string, tenantId: string, query: string): Promise<CustomerHit[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) return [];
  const companies = parsePage("companies", await apiRequest(`/v1/tenants/${tenantId}/companies?limit=20&q=${encodeURIComponent(q)}`, accessToken));
  if (companies.entity !== "companies" || companies.items.length === 0) return [];
  const byId = new Map(companies.items.map((c) => [c.id, c]));
  const hits: CustomerHit[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < NEWEST_LEAD_PAGES && hits.length < 10; i++) {
    const page = await fetchPage(accessToken, tenantId, "leads", cursor);
    if (page.entity !== "leads") break;
    for (const lead of page.items) {
      const company = lead.company_id ? byId.get(lead.company_id) : undefined;
      if (company && hits.length < 10) hits.push({ leadId: lead.id, label: company.name, city: company.city ?? null });
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return hits;
}
