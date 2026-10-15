import type { SiteIn, SiteOut } from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, iso, list, nstr, optStr, rec, uuid } from "./shape";

/**
 * Customer sites (job CO, on the API of job CN, ADR 0085; module `sites`): a customer can have many, each with an address, a map pin, a site contact and the notes a driver needs. Server side only, with the
 * signed-in user's own token. Every member reads; Owner, Admin and Sales write. Free text refuses phone numbers and e-mail addresses (the API says so with a 422); the site contact is a contact of the customer.
 */
const num = (v: unknown, what: string, min: number, max: number): number | null => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : bad(what));

export function parseSite(json: unknown): SiteOut {
  const r = rec(json, "site");
  return {
    id: uuid(r.id, "id"),
    company_id: uuid(r.company_id, "company_id"),
    name: nstr(r.name, "name", 200),
    address_line: optStr(r.address_line, "address_line", 400),
    city: optStr(r.city, "city", 120),
    pin: optStr(r.pin, "pin", 12),
    map_lat: num(r.map_lat, "map_lat", -90, 90),
    map_lng: num(r.map_lng, "map_lng", -180, 180),
    distance_km: num(r.distance_km, "distance_km", 0, 5000),
    lane_width_ft: num(r.lane_width_ft, "lane_width_ft", 0, 1000),
    night_delivery: bool(r.night_delivery, "night_delivery"),
    unloading_help: bool(r.unloading_help, "unloading_help"),
    access_notes: optStr(r.access_notes, "access_notes", 1000),
    site_contact_id: r.site_contact_id === null || r.site_contact_id === undefined ? null : uuid(r.site_contact_id, "site_contact_id"),
    active: bool(r.active, "active"),
    created_at: iso(r.created_at, "created_at"),
    updated_at: iso(r.updated_at, "updated_at"),
  };
}

export function parseSiteList(json: unknown): { items: SiteOut[]; next_cursor: string | null } {
  const r = rec(json, "site list");
  return { items: list(r.items, "items", 200).map(parseSite), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseSiteSaved(json: unknown): { site: SiteOut; created: boolean } {
  const r = rec(json, "saved site");
  return { site: parseSite(r.site), created: bool(r.created, "created") };
}

const path = (tenantId: string, tail = "") => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/sites${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};

/** `GET /sites?company_id=`: a customer's sites (or all), newest first. `includeInactive` shows the ones put away. */
export async function listSites(accessToken: string, tenantId: string, opts: { companyId?: string; includeInactive?: boolean; after?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.companyId) q.set("company_id", idOf(opts.companyId));
  if (opts.includeInactive) q.set("include_inactive", "true");
  if (opts.after) q.set("after", opts.after);
  return parseSiteList(await apiRequest(path(tenantId, `?${q.toString()}`), accessToken));
}

export async function getSite(accessToken: string, tenantId: string, id: string) {
  return parseSite(await apiRequest(path(tenantId, `/${idOf(id)}`), accessToken));
}

/** `PUT /sites/{id}`: create or change, the whole site at once; the same id again is a retry. */
export async function putSite(accessToken: string, tenantId: string, id: string, input: SiteIn) {
  return parseSiteSaved(await apiRequest(path(tenantId, `/${idOf(id)}`), accessToken, { method: "PUT", body: JSON.stringify(input) }));
}
