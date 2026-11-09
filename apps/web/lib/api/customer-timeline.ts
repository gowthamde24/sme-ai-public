import { parseProfile, type LeadProfile } from "@/lib/lead-desk/profile";

import { ApiContractError, apiRequest } from "./client";

/**
 * One customer's timeline (app v4 part 3; C1's docs/contracts/customer-timeline.md): `GET /customers/{lead_id}/timeline?before=&limit=`. Every call, message in and out, the first arrival, quote, visit, order, follow-up and outcome,
 * newest first, each with a short text (at most 200 characters), the thing it is about (`target`) and a few facts (`detail`). Notes are not in it yet (there is no notes table) and calls carry no recording yet. Checked field by
 * field: a row of a kind this screen does not know, or that breaks the contract, is left out rather than drawn wrong.
 */
export const TIMELINE_KINDS = ["call", "message_in", "arrival", "message_out", "quote", "visit", "order", "follow_up", "outcome"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
export type TimelineItem = { kind: TimelineKind; at: string; text: string; target: { type: string; id: string }; detail: Readonly<Record<string, string | number | boolean | null>> };
export type TimelinePage = { items: TimelineItem[]; nextBefore: string | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function parseTimeline(json: unknown): TimelinePage {
  if (!isRec(json) || !Array.isArray(json.items)) throw new Error("timeline: not a page");
  const items = json.items.flatMap((r): TimelineItem[] => {
    if (!isRec(r) || !(TIMELINE_KINDS as readonly unknown[]).includes(r.kind) || !isIso(r.at) || typeof r.text !== "string" || !isRec(r.target)) return [];
    if (typeof r.target.type !== "string" || typeof r.target.id !== "string") return [];
    const detail = isRec(r.detail) ? Object.fromEntries(Object.entries(r.detail).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))) : {};
    return [{ kind: r.kind as TimelineKind, at: r.at, text: r.text.slice(0, 200), target: { type: r.target.type, id: r.target.id }, detail: detail as TimelineItem["detail"] }];
  });
  return { items, nextBefore: isIso(json.next_before) ? json.next_before : null };
}

/**
 * The customer page's header, from ONE read of `GET /leads/{id}`: the name the API shows (`display_name`), the status, the company, where they came from and the profile (what they want, their language). Checked field by
 * field; `fetchLead` keeps only the list row, so it cannot be used for these.
 */
export type CustomerHead = { name: string; status: string; companyId: string | null; source: string | null; language: string | null; profile: LeadProfile | null };
export function parseCustomerHead(json: unknown): CustomerHead {
  if (!isRec(json) || typeof json.status !== "string") throw new ApiContractError("lead");
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);
  const p = isRec(json.profile) ? json.profile : null;
  return {
    name: s(json.display_name, 200) ?? "",
    status: json.status,
    companyId: s(json.company_id, 40),
    source: s(p?.source, 60) ?? s(json.source, 60),
    language: typeof p?.language === "string" && /^[a-z]{2,3}$/.test(p.language) ? p.language : null,
    profile: parseProfile(p),
  };
}
export async function fetchCustomerHead(accessToken: string, tenantId: string, leadId: string): Promise<CustomerHead> {
  return parseCustomerHead(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/leads/${encodeURIComponent(leadId)}`, accessToken));
}

export async function fetchTimeline(accessToken: string, tenantId: string, leadId: string, before?: string | null, limit = 50): Promise<TimelinePage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", before);
  return parseTimeline(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/customers/${encodeURIComponent(leadId)}/timeline?${q}`, accessToken));
}
