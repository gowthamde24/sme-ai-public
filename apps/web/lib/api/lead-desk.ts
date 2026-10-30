import type { DeskFilter, DeskLead, LeadStatus } from "@/lib/lead-desk/leads";
import { LEAD_STATUSES } from "@/lib/lead-desk/leads";
import { parseProfile, type FixField, type LeadProfile } from "@/lib/lead-desk/profile";

import { ApiContractError, apiRequest } from "./client";
import { fetchContact, isCanonicalUuid } from "./crm";
import { bad, list, oneOf, optIso, optStr, rec, str } from "./shape";

/**
 * The leads of Lead Desk from the CRM (night 4, part A6): `GET /v1/tenants/{id}/leads` (a page, newest first) and the name of each lead's contact; `PATCH /leads/{id}` hands a lead to a member (`owner_user_id`). The history of one
 * lead (`GET /leads/{id}/touches`, every time the same person arrived again) is read here too. SERVER ONLY, with the person's own token.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}`;
};
const NAME_FALLBACK = "";

export function parseLeadPage(json: unknown): { rows: { id: string; contactId: string | null; source: string | null; status: LeadStatus; ownerUserId: string | null; createdAt: string; profile: LeadProfile | null; isNew: boolean }[]; nextCursor: string | null } {
  const x = rec(json, "leads");
  return {
    rows: list(x.items, "items", 200).map((row) => {
      const r = rec(row, "lead");
      const id = str(r.id, "id", 80);
      if (!isCanonicalUuid(id)) bad("id");
      const contact = r.contact_id === null || r.contact_id === undefined ? null : str(r.contact_id, "contact_id", 80);
      const owner = r.owner_user_id === null || r.owner_user_id === undefined ? null : str(r.owner_user_id, "owner_user_id", 80);
      return { id, contactId: contact, source: optStr(r.source, "source", 100), status: oneOf(r.status, LEAD_STATUSES, "status"), ownerUserId: owner, createdAt: optIso(r.created_at, "created_at") ?? "", profile: parseProfile(r.profile), isNew: r.is_new === true };
    }),
    nextCursor: optStr(x.next_cursor, "next_cursor", 300),
  };
}

/** One page of leads with the contact's name (contacts that cannot be read show no name: the screen says "Lead"). */
export async function listDeskLeads(token: string, tenantId: string, cursor?: string | null, filter?: DeskFilter): Promise<{ leads: DeskLead[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: "25" });
  if (cursor) q.set("cursor", cursor);
  // the API narrows the list itself (so a page is never spent on leads the person filtered out); "mine" and "hot" are this app's own
  if (filter) {
    if (filter.status) q.set("status", filter.status);
    if (filter.source) q.set("source", filter.source);
    if (filter.urgency) q.set("urgency", filter.urgency);
    if (filter.q) q.set("q", filter.q);
    if (!filter.junk) q.set("junk", "hide"); // flagged, never deleted: out of the list until the person asks for it
  }
  const page = parseLeadPage(await apiRequest(`${base(tenantId)}/leads?${q}`, token));
  const names = await Promise.allSettled(page.rows.map((r) => (r.contactId && isCanonicalUuid(r.contactId) ? fetchContact(token, tenantId, r.contactId) : Promise.reject(new Error("none")))));
  return {
    leads: page.rows.map((r, i) => {
      const contact = names[i].status === "fulfilled" ? (names[i] as PromiseFulfilledResult<{ full_name: string; phone: string | null }>).value : null;
      return { ...r, name: contact ? contact.full_name : NAME_FALLBACK, phone: contact?.phone ?? null, hot: false };
    }),
    nextCursor: page.nextCursor,
  };
}

export async function setLeadOwner(token: string, tenantId: string, leadId: string, ownerUserId: string | null): Promise<void> {
  if (!isCanonicalUuid(leadId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/leads/${leadId}`, token, { method: "PATCH", body: JSON.stringify({ owner_user_id: ownerUserId }) });
}

/** The person opened the lead: it is not "new" for them any more (`POST /leads/{id}/seen`, 204). Best effort: a failure changes nothing on screen. */
export async function markLeadSeen(token: string, tenantId: string, leadId: string): Promise<void> {
  if (!isCanonicalUuid(leadId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/leads/${leadId}/seen`, token, { method: "POST", body: JSON.stringify({}) });
}

export type Touch = { at: string; kind: "first" | "repeat"; source: string; message: string | null };
export function parseTouches(json: unknown): { items: Touch[]; flags: ("dnd" | "invalid_number")[] } {
  const x = rec(json, "touches");
  return {
    items: list(x.items, "items", 200).map((row) => {
      const r = rec(row, "touch");
      return { at: optIso(r.at, "at") ?? "", kind: oneOf(r.kind, ["first", "repeat"] as const, "kind"), source: str(r.source, "source", 40), message: optStr(r.message, "message", 1000) };
    }),
    flags: list(x.flags ?? [], "flags", 5).map((f) => oneOf(f, ["dnd", "invalid_number"] as const, "flag")),
  };
}
export async function getTouches(token: string, tenantId: string, leadId: string): Promise<ReturnType<typeof parseTouches>> {
  if (!isCanonicalUuid(leadId)) throw new ApiContractError("id");
  return parseTouches(await apiRequest(`${base(tenantId)}/leads/${leadId}/touches`, token));
}

/** The lead's normalised profile (`GET /leads/{id}`); null when the API gives none. */
export async function getLeadProfile(token: string, tenantId: string, leadId: string): Promise<LeadProfile | null> {
  if (!isCanonicalUuid(leadId)) throw new ApiContractError("id");
  const x = rec(await apiRequest(`${base(tenantId)}/leads/${leadId}`, token), "lead");
  return parseProfile(x.profile);
}

/** One tap fixes a field (`PATCH /leads/{id}/profile`): the value is kept for good and never overwritten by a later guess. `null` clears it. */
export async function fixLeadField(token: string, tenantId: string, leadId: string, field: FixField, value: string | null): Promise<void> {
  if (!isCanonicalUuid(leadId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/leads/${leadId}/profile`, token, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
}
