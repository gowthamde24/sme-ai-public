import { apiRequest } from "./client";
import { isCanonicalUuid, parsePage, type ContactRow } from "./crm";

/**
 * The consent and opt-out list (job CC, screen 2): who has asked us to stop and what the rest of the list has agreed to, read from the contacts the person can already see (no new API route). The first CONTACT_PAGES pages of 100 are
 * read; when there are more, the list says it looked at the first ones only. A contact is "stopped" when it is on the do-not-contact list or has withdrawn consent on any channel. Nothing is changed here: consent is recorded
 * on the contact's own consent page.
 */
export const CONTACT_PAGES = 5;
export const PAGE_LIMIT = 100;
export type Consent = "unknown" | "granted" | "withdrawn";
export type Channel = "email" | "whatsapp" | "phone";
export const CHANNELS: readonly Channel[] = ["whatsapp", "phone", "email"];

export interface StoppedContact {
  id: string;
  name: string;
  /** Why the person is on the do-not-contact list (a closed word), or null when only a consent was withdrawn. */
  reason: string | null;
  channels: Record<Channel, Consent>;
}
export interface ConsentList {
  checked: number;
  truncated: boolean;
  stopped: StoppedContact[];
  counts: Record<Channel, Record<Consent, number>>;
}

export function summarise(contacts: readonly ContactRow[], truncated: boolean): ConsentList {
  const counts = Object.fromEntries(CHANNELS.map((c) => [c, { unknown: 0, granted: 0, withdrawn: 0 }])) as ConsentList["counts"];
  const stopped: StoppedContact[] = [];
  for (const c of contacts) {
    const channels: Record<Channel, Consent> = { email: c.email_consent, whatsapp: c.whatsapp_consent, phone: c.phone_consent };
    for (const ch of CHANNELS) counts[ch][channels[ch]] += 1;
    if (c.suppression_reason !== null || CHANNELS.some((ch) => channels[ch] === "withdrawn")) stopped.push({ id: c.id, name: c.full_name, reason: c.suppression_reason, channels });
  }
  stopped.sort((a, b) => a.name.localeCompare(b.name));
  return { checked: contacts.length, truncated, stopped, counts };
}

export async function readConsentList(token: string, tenantId: string): Promise<ConsentList> {
  if (!isCanonicalUuid(tenantId)) throw new Error("workspace id");
  const all: ContactRow[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < CONTACT_PAGES; page += 1) {
    const q = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) q.set("cursor", cursor);
    const got = parsePage("contacts", await apiRequest(`/v1/tenants/${tenantId}/contacts?${q.toString()}`, token));
    if (got.entity !== "contacts") throw new Error("page");
    all.push(...got.items);
    cursor = got.nextCursor;
    if (!cursor) break;
    if (page === CONTACT_PAGES - 1) truncated = true;
  }
  return summarise(all, truncated);
}
