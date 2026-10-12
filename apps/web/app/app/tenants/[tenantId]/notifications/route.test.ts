import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";
const L = "55555555-5555-4555-8555-555555555555";
const NOW = Date.parse("2026-10-12T10:00:00Z");

const h = vi.hoisted(() => ({
  user: null as null | { accessToken: string },
  tenant: vi.fn(),
  today: vi.fn(),
  proposals: vi.fn(),
  visits: vi.fn(),
  outbox: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/outbox", () => ({ listOutboxMessages: (...a: unknown[]) => h.outbox(...a) }));
vi.mock("@/lib/api/visits", () => ({ getTodayVisits: (...a: unknown[]) => h.visits(...a) }));
vi.mock("../today-read", () => ({ readTodayCached: (...a: unknown[]) => h.today(...a) }));
vi.mock("../today-visits", () => ({ readProposals: (...a: unknown[]) => h.proposals(...a) }));

import { GET } from "./route";
import { readNotices } from "./notifications-data";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin" };
function get(headers: Record<string, string> = SAME, tenant = T) {
  return GET(new NextRequest(`https://${HOST}/app/tenants/${tenant}/notifications`, { headers }), { params: Promise.resolve({ tenantId: tenant }) });
}

const needs = (kind: string, id: string, target: { type: string; id: string }, customer = "Asha", at = "2026-10-12T09:00:00Z") => ({ kind, id, customer, city: null, agent: "quote_writer", summary: "SECRET WORDS", at, amount_paise: 5000, target });

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.today.mockReset().mockResolvedValue({ needs_you: [], recent: [] });
  h.proposals.mockReset().mockResolvedValue([]);
  h.visits.mockReset().mockResolvedValue({ items: [] });
  h.outbox.mockReset().mockResolvedValue({ items: [] });
});

describe("GET /app/tenants/[id]/notifications", () => {
  it("answers with the notices, never cached, reading with the PERSON's token", async () => {
    h.today.mockResolvedValue({ needs_you: [needs("quote_approval", O, { type: "quote", id: O })], recent: [] });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.items).toEqual([{ id: `quote_approval:${O}`, kind: "needs_you", code: "quote_approval", who: "Asha", at: "2026-10-12T09:00:00Z", href: `/app/tenants/${T}/quotes` }]);
    expect(h.tenant).toHaveBeenCalledWith("person-token", T);
    expect(h.today).toHaveBeenCalledWith("person-token", T);
  });
  it("copies no words of a message, no amount and no summary", async () => {
    h.today.mockResolvedValue({ needs_you: [needs("outbox_approval", M, { type: "message", id: M })], recent: [] });
    h.outbox.mockResolvedValue({ items: [{ id: L, customer: "Lakshmi", text: "PRIVATE MESSAGE", reason_text: "PRIVATE REASON", created_at: new Date(NOW).toISOString(), decided_at: null }] });
    const text = await (await get()).text();
    expect(text).not.toMatch(/SECRET WORDS|PRIVATE|5000/);
  });
  it("refuses a request that is not from this site, a bad id, and a signed-out person", async () => {
    expect((await get({ host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get(SAME, "not-a-uuid")).status).toBe(404);
    h.user = null;
    expect((await get()).status).toBe(401);
    expect(h.today).not.toHaveBeenCalled();
  });
  it("401 when the session is rejected by the API, 404 for a workspace that is not theirs, 503 for a broken API", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    expect((await get()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect((await get()).status).toBe(404);
    h.tenant.mockRejectedValueOnce(new Error("boom"));
    expect((await get()).status).toBe(503);
    h.today.mockRejectedValueOnce(new ApiAuthError());
    expect((await get()).status).toBe(401);
  });
});

describe("readNotices", () => {
  const base = `/app/tenants/${T}`;
  it("builds a page for each kind of 'needs you', and a Today anchor for a message or a call", async () => {
    h.today.mockResolvedValue({
      needs_you: [
        needs("order_money_held", O, { type: "order", id: O }, "A", "2026-10-12T09:01:00Z"),
        needs("followup_due", L, { type: "lead", id: L }, "B", "2026-10-12T09:02:00Z"),
        needs("outbox_approval", M, { type: "message", id: M }, "C", "2026-10-12T09:03:00Z"),
        needs("call_approval", V, { type: "enquiry", id: V }, "D", "2026-10-12T09:04:00Z"),
      ],
      recent: [],
    });
    const out = await readNotices("t", T, "owner", NOW);
    expect(out.map((n) => n.href)).toEqual([`${base}/enquiries/${V}`, `${base}#needs-you`, `${base}/leads/${L}`, `${base}/orders/${O}`]);
    expect(out.every((n) => n.kind === "needs_you")).toBe(true);
  });
  it("adds proposed visits, customers who are here now, and messages blocked within a day; newest first", async () => {
    h.proposals.mockResolvedValue([{ type: "visit", id: V, at: "2026-10-12T08:00:00Z", visit: { who: "Meena", customer: "Meena Silks" } }]);
    h.visits.mockResolvedValue({ items: [{ id: L, who: "Ravi", starts_at: "2026-10-12T09:30:00Z", visit_status: "arrived" }, { id: O, who: "Soon", starts_at: "2026-10-12T11:00:00Z", visit_status: "booked" }] });
    h.outbox.mockResolvedValue({
      items: [
        { id: M, customer: "Latha", created_at: "2026-10-12T07:00:00Z", decided_at: "2026-10-12T09:45:00Z" },
        { id: T, customer: "Old", created_at: "2026-10-09T07:00:00Z", decided_at: null },
      ],
    });
    const out = await readNotices("t", T, "owner", NOW);
    expect(out.map((n) => `${n.code}:${n.who}`)).toEqual(["message_blocked:Latha", "visit_here:Ravi", "visit_proposed:Meena Silks"]);
    expect(h.outbox).toHaveBeenCalledWith("t", T, { limit: 5, tab: "blocked" });
  });
  it("a viewer is never told about proposals or the Outbox", async () => {
    h.outbox.mockResolvedValue({ items: [{ id: M, customer: "Latha", created_at: new Date(NOW).toISOString(), decided_at: null }] });
    expect(await readNotices("t", T, "viewer", NOW)).toEqual([]);
    expect(h.proposals).not.toHaveBeenCalled();
    expect(h.outbox).not.toHaveBeenCalled();
  });
  it("leaves out a part that cannot be read, and never invents one", async () => {
    h.today.mockRejectedValue(new Error("down"));
    h.visits.mockRejectedValue(new Error("down"));
    h.outbox.mockResolvedValue({ items: [{ id: M, customer: null, created_at: new Date(NOW - 1000).toISOString(), decided_at: null }] });
    const out = await readNotices("t", T, "owner", NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "message_blocked", who: "", href: `${base}/outbox?tab=blocked` });
  });
  it("passes a rejected session on", async () => {
    h.outbox.mockRejectedValue(new ApiAuthError());
    await expect(readNotices("t", T, "owner", NOW)).rejects.toBeInstanceOf(ApiAuthError);
  });
});
