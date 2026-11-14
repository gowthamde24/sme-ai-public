import { describe, expect, it } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";

import { ago, clockTime, count, mmss, percentText, shortDate, waiting } from "./format";
import { REASONS, reasonProblem } from "./reasons";
import { failureOf, makeSource, mockRoleOf } from "./source";
import { accessJson, meJson, overviewJson, searchJson, supportViewJson } from "./staff-fixtures";
import { parseMe, parseOverview, parseSearch, parseSupportView } from "./types";

const NOW = new Date("2026-11-13T12:30:00.000Z"); // 6:00 pm in India

describe("the staff console's made-up sample", () => {
  it("passes the very readers the real API's answers pass, for each role", () => {
    for (const role of ["owner", "support", "finance"] as const) {
      expect(parseMe(meJson(role)).role).toBe(role);
      expect(parseOverview(overviewJson(role, NOW)).role).toBe(role);
    }
  });
  it("is the approved mock's numbers: six businesses, five tickets of seven open, six health parts, six providers", () => {
    const o = parseOverview(overviewJson("owner", NOW));
    expect(o.kpis.mrr).toEqual({ text: "₹2,41,800", changePercent: 12 });
    expect(o.kpis.active).toEqual({ count: 128, addedThisWeek: 9, onFreeStart: 14 });
    expect(o.kpis.calls).toEqual({ count: 3412, connectedPercent: 98.6 });
    expect(o.kpis.margin?.percent).toBe(41);
    expect(o.businesses).toHaveLength(6);
    expect(o.businesses.map((b) => b.status)).toEqual(["live", "live", "paused", "in_training", "live", "not_live"]);
    expect(o.supportQueue?.totalOpen).toBe(7);
    expect(o.supportQueue?.items).toHaveLength(5);
    expect(o.health.components.map((c) => c.key)).toEqual(["api", "phone_calls", "whatsapp", "voice", "database", "payments"]);
    expect(o.costs?.providers.map((p) => p.provider)).toEqual(["cartesia", "sarvam", "plivo", "anthropic", "meta", "google"]);
    expect(o.costs?.marginText).toBe("₹1,57,900");
  });
  it("leaves out what the API leaves out for the role: support has no money, finance has no support queue; everyone has badges, calls, health and businesses", () => {
    const support = parseOverview(overviewJson("support", NOW));
    expect([support.kpis.mrr, support.kpis.margin, support.costs]).toEqual([null, null, null]);
    expect(support.supportQueue).not.toBeNull();
    const finance = parseOverview(overviewJson("finance", NOW));
    expect(finance.supportQueue).toBeNull();
    expect(finance.kpis.mrr).not.toBeNull();
    for (const o of [support, finance]) expect([o.badges.businesses, o.kpis.calls.count, o.health.components.length, o.businesses.length]).toEqual([128, 3412, 6, 6]);
  });
  it("says Voice is not measured (unknown), as the API does today", () => {
    expect(parseOverview(overviewJson("owner", NOW)).health.components.find((c) => c.key === "voice")?.state).toBe("unknown");
  });
  it("searches business names and towns, and gives support no invoices and finance no tickets", () => {
    expect(parseSearch(searchJson("owner", "lakshmi", NOW)).businesses.map((b) => b.name)).toEqual(["Sri Lakshmi Silks", "Lakshmi Textiles"]);
    expect(parseSearch(searchJson("support", "silks", NOW)).invoices).toEqual([]);
    expect(parseSearch(searchJson("finance", "silks", NOW)).tickets).toEqual([]);
  });
});

describe("the readers refuse an answer that does not match", () => {
  it("a missing or mistyped part", () => {
    const ok = overviewJson("owner", NOW);
    expect(() => parseOverview({ ...ok, badges: null })).toThrow(ApiContractError);
    expect(() => parseOverview({ ...ok, role: "admin" })).toThrow(ApiContractError);
    expect(() => parseOverview({ ...ok, generated_at: "yesterday" })).toThrow(ApiContractError);
    expect(() => parseOverview("nope")).toThrow(ApiContractError);
    const health = ok.health as { components: { state: string }[] };
    expect(() => parseOverview({ ...ok, health: { ...health, components: [{ ...health.components[0], state: "fine" }] } })).toThrow(ApiContractError);
  });
  it("a support view that is not marked as the masked support view", () => {
    const view = supportViewJson("00000000-0000-4000-8000-000000000001", NOW);
    expect(parseSupportView(view).recentCalls[0].customer).toBe("P•••••• N••••");
    expect(() => parseSupportView({ ...view, support_view: false })).toThrow(ApiContractError);
  });
  it("keeps a null MRR change null (it is hidden, never drawn as 0)", () => {
    const ok = overviewJson("owner", NOW) as { kpis: { mrr: Record<string, unknown> } };
    const o = parseOverview({ ...ok, kpis: { ...ok.kpis, mrr: { ...ok.kpis.mrr, change_percent: null } } });
    expect(o.kpis.mrr?.changePercent).toBeNull();
  });
});

describe("what a refusal means", () => {
  const refused = (status: number, code: string) => new ApiRequestError(status, code, "x");
  it("401 is a session that ended; 403 not_staff, second_factor_required and forbidden are one plain 'no access'; access_required is its own", () => {
    expect(failureOf(new ApiAuthError("x"))).toBe("signed_out");
    expect(failureOf(refused(401, "session_ended"))).toBe("signed_out");
    for (const code of ["not_staff", "second_factor_required", "forbidden"]) expect(failureOf(refused(403, code))).toBe("no_access");
    expect(failureOf(refused(403, "access_required"))).toBe("access_required");
  });
  it("409 owner_ok_required, 422 reason_required, the Phase 2 words; everything else is 'unavailable'", () => {
    expect(failureOf(refused(409, "owner_ok_required"))).toBe("owner_ok_required");
    expect(failureOf(refused(422, "reason_required"))).toBe("reason_required");
    expect(failureOf(refused(403, "second_confirm_required"))).toBe("second_confirm_required");
    expect(failureOf(refused(409, "goodwill_limit"))).toBe("goodwill_limit");
    expect(failureOf(refused(409, "ticket_closed"))).toBe("ticket_closed");
    expect(failureOf(refused(404, "not_found"))).toBe("not_found");
    expect(failureOf(refused(422, "validation_error"))).toBe("invalid");
    for (const e of [refused(500, "boom"), refused(409, "other"), refused(503, "api_unreachable"), new ApiContractError("x"), new Error("x")]) expect(failureOf(e)).toBe("unavailable");
  });
});

describe("the mock source", () => {
  const source = (role: "owner" | "support" | "finance" = "owner") => makeSource("mock", "token", role, () => NOW);
  it("reads the role from ?role= only when it is one of the three", () => {
    expect(mockRoleOf("/staff?role=support")).toBe("support");
    expect(mockRoleOf("/staff/businesses/x?access=a&role=finance")).toBe("finance");
    for (const bad of ["/staff?role=admin", "/staff", null, undefined, "/staff?role="]) expect(mockRoleOf(bad)).toBe("owner");
  });
  it("answers me, overview and search, and fails like the API on a missing reason", async () => {
    const s = source("support");
    expect((await s.me()).ok).toBe(true);
    const o = await s.overview();
    expect(o.ok && o.data.role).toBe("support");
    const hit = await s.search("sarees");
    expect(hit.ok && hit.data.businesses.map((b) => b.name)).toEqual(["Sri Venkateswara Sarees", "Gayatri Saree Point"].filter((n) => n.toLowerCase().includes("sarees")));
    expect(await s.access("00000000-0000-4000-8000-000000000001", "other", "  ")).toEqual({ ok: false, failure: "reason_required" });
  });
  it("opens a business only with the access that the reason box gave, and never one the sample does not have", async () => {
    const s = source();
    const id = "00000000-0000-4000-8000-000000000002";
    const granted = await s.access(id, "support_ticket", null);
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    expect(granted.data.accessId).toBe(accessJson(id, NOW).access_id);
    const view = await s.view(id, granted.data.accessId);
    expect(view.ok && view.data.business?.name).toBe("Sri Venkateswara Sarees");
    expect(await s.view(id, "guess")).toEqual({ ok: false, failure: "access_required" });
    expect(await s.view("00000000-0000-4000-8000-0000000000ff", "mock-access-x")).toEqual({ ok: false, failure: "access_required" });
  });
});

describe("the reason", () => {
  it("must be one of the list; 'something else' must say what in 3 to 300 characters", () => {
    expect(REASONS.map((r) => r.code)).toEqual(["support_ticket", "customer_asked", "privacy_request", "incident", "billing_dispute", "other"]);
    expect(reasonProblem("", "")).toBe("choose");
    expect(reasonProblem("because", "")).toBe("choose");
    expect(reasonProblem("support_ticket", "")).toBeNull();
    expect(reasonProblem("other", "ab")).toBe("say_what");
    expect(reasonProblem("other", "x".repeat(301))).toBe("say_what");
    expect(reasonProblem("other", "  a customer rang  ")).toBeNull();
  });
});

describe("times and counts", () => {
  it("writes India time", () => {
    expect(clockTime("2026-11-13T12:30:00Z")).toBe("6:00 pm");
    expect(shortDate("2026-11-13T20:00:00Z")).toBe("14 Nov"); // 1:30 am the next day in India
  });
  it("says how long ago, against the time the API answered", () => {
    const now = "2026-11-13T12:30:00Z";
    const back = (min: number) => new Date(Date.parse(now) - min * 60_000).toISOString();
    expect(ago(null, now)).toBe("No activity yet");
    expect(ago(back(0), now)).toBe("Just now");
    expect(ago(back(2), now)).toBe("2 min ago");
    expect(ago(back(180), now)).toBe("3 h ago");
    expect(ago(back(60 * 24), now)).toBe("Yesterday");
    expect(ago(back(60 * 24 * 2), now)).toBe("2 days ago");
    expect(ago(back(60 * 24 * 40), now)).toBe("4 Oct");
  });
  it("waits, counts, percentages and call lengths", () => {
    expect([waiting(0), waiting(12), waiting(60), waiting(150), waiting(34)]).toEqual(["1 min", "12 min", "1 h", "2 h 30 min", "34 min"]);
    expect([count(3412), count(241800)]).toEqual(["3,412", "2,41,800"]);
    expect([percentText(98.6), percentText(41), percentText(98.64)]).toEqual(["98.6", "41", "98.6"]);
    expect([mmss(84), mmss(0), mmss(5)]).toEqual(["1:24", "0:00", "0:05"]);
  });
});
