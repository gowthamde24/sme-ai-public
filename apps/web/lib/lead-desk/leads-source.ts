import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getTouches, listDeskLeads, setLeadOwner, type Touch } from "@/lib/api/lead-desk";
import { readJar, writeJar } from "@/lib/mock/jar";
import { leadsScreens } from "@/lib/screens/flag";
import type { Handoff } from "@/lib/outreach/types";

import { mockLeads, type DeskFilter, type DeskLead } from "./leads";

/**
 * Where the leads of Lead Desk come from (night 4, part A6): `mock` = fourteen made-up leads (who they are handed to is kept in a cookie), `on` = the CRM's leads with the contact's name, `off` = not there. A lead is HOT when an open
 * hand-off names it (by lead, else by contact; in the test screens by name). An assignment is the CRM's `owner_user_id`. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string; userId: string };
const COOKIE = "sme_leaddesk_mock";
type Assigned = Record<string, string | null>;
const parseAssigned = (v: unknown): Assigned | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Assigned = {};
  for (const [k, x] of Object.entries(v).slice(0, 30)) if (/^[0-9a-f-]{36}$/.test(k) && (x === null || (typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)))) out[k] = x;
  return out;
};

export function markHot(leads: readonly DeskLead[], handoffs: readonly Handoff[], byName: boolean): DeskLead[] {
  const open = handoffs.filter((h) => h.actedAt === null);
  return leads.map((l) => ({ ...l, hot: open.some((h) => (h.leadId !== null && h.leadId === l.id) || (l.contactId !== null && h.contactId === l.contactId) || (byName && h.contactName === l.name)) }));
}

export async function readDeskLeads(ctx: Ctx, handoffs: readonly Handoff[] | null, cursor: string | null = null, now: Date = new Date(), filter?: DeskFilter): Promise<{ leads: DeskLead[]; nextCursor: string | null } | null> {
  const mode = leadsScreens();
  if (mode === "off") return null;
  if (mode === "mock") {
    const assigned = await readJar(COOKIE, parseAssigned, {});
    return { leads: markHot(mockLeads(now, assigned, [], ctx.userId), handoffs ?? [], true), nextCursor: null };
  }
  try {
    const page = await listDeskLeads(ctx.token, ctx.tenantId, cursor, filter);
    return { leads: markHot(page.leads, handoffs ?? [], false), nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export type AssignResult = { ok: true } | { ok: false; error: "forbidden" | "read_only" | "invalid" | "not_available" | "down" };
/** Hand a lead to a member (or to nobody). The Owner and Admin do it (the API decides). */
export async function assignLead(ctx: Ctx, leadId: string, ownerUserId: string | null): Promise<AssignResult> {
  const mode = leadsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const cur = await readJar(COOKIE, parseAssigned, {});
    return (await writeJar(COOKIE, { ...cur, [leadId]: ownerUserId }, 7)) ? { ok: true } : { ok: false, error: "invalid" };
  }
  try {
    await setLeadOwner(ctx.token, ctx.tenantId, leadId, ownerUserId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.code === "workspace_read_only") return { ok: false, error: "read_only" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422 || error.status === 400) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "down" };
  }
}

/** The history of one lead: every time the same person arrived (first, then repeats from another file or portal). */
export async function readTouches(ctx: Ctx, leadId: string, now: Date = new Date()): Promise<{ items: Touch[]; flags: ("dnd" | "invalid_number")[] } | null> {
  const mode = leadsScreens();
  if (mode === "off") return null;
  if (mode === "mock") {
    const lead = mockLeads(now, {}, [], ctx.userId).find((l) => l.id === leadId);
    if (!lead) return null;
    return { items: [{ at: lead.createdAt, kind: "first", source: lead.source ?? "webhook", message: "Interested in the 2 BHK, please call." }, ...(lead.name.length % 2 === 0 ? [{ at: new Date(new Date(lead.createdAt).getTime() + 86_400_000).toISOString(), kind: "repeat" as const, source: "indiamart", message: null }] : [])], flags: [] };
  }
  try {
    return await getTouches(ctx.token, ctx.tenantId, leadId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
