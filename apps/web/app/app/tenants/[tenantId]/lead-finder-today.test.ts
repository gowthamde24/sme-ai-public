import { beforeEach, describe, expect, it, vi } from "vitest";

import { NOTHING_TODAY, type NeedsCard, type TodayData } from "@/components/v2/app/today/types";
import { appT } from "@/i18n/app";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseProspect, parseStats } from "@/lib/api/lead-finder";
import { PROSPECT_LOW, PROSPECT_READY } from "@/lib/api/lead-finder-fixtures";

const listProspects = vi.fn();
const getProspectStats = vi.fn();
vi.mock("@/lib/api/lead-finder", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lead-finder")>()), listProspects: (...a: unknown[]) => listProspects(...a), getProspectStats: (...a: unknown[]) => getProspectStats(...a) }));

import { finderAccess } from "@/lib/lead-finder/types";

import { finderCards, finderUpsellCard, MAX_ROWS, readFinderNeeds } from "./lead-finder-today";
import { mergeDesk } from "./today-data";

const en = appT("en");
const t = (key: string, vars?: Record<string, string | number>) => en(key as "frame.notyet", vars);
const BASE = "/app/tenants/T";
const CTX = { token: "tok", tenantId: "T" };
// the frame's answer (`readFinderAccessCached`): what the availability and the plan tier say together (lib/lead-finder/types.ts finderAccess)
const ON = finderAccess({ available: true, source: "fixture", reason: "ok" }, true);
const row = (n: number, over: Record<string, unknown> = {}) => parseProspect({ ...PROSPECT_LOW, id: `b1b1b1b1-0000-4000-8000-${String(n).padStart(12, "0")}`, updated_at: `2026-10-27T0${n % 10}:00:00Z`, ...over });
const summaryOf = (c: NeedsCard) => (c.type === "item" ? [c.item.customer, c.item.summary, c.item.href] : null);

beforeEach(() => {
  vi.clearAllMocks();
  listProspects.mockResolvedValue({ items: [parseProspect(PROSPECT_LOW)], nextCursor: null });
  getProspectStats.mockResolvedValue(parseStats({ total: 18, by_status: { needs_owner: 1, skipped: 7 } }));
});

describe("the Lead Finder's Needs-you rows (contract section 3)", () => {
  it("one short row per business: '{name} · fit {n} · {reason}', opening the Prospects tab on that business", () => {
    const cards = finderCards([parseProspect(PROSPECT_LOW)], 1, BASE, t);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: "item", key: `prospect_waiting-${PROSPECT_LOW.id}`, item: { kind: "prospect_waiting", agent: "lead_finder", city: null, amount_paise: null } });
    expect(summaryOf(cards[0])).toEqual(["Sri Sai Constructions", "fit 64 · low stock", `${BASE}/retailers?id=${PROSPECT_LOW.id}`]);
  });
  it("only the ones that need a person; at most five, then one row for the rest that opens the tab filtered to them", () => {
    expect(finderCards([parseProspect(PROSPECT_READY)], 0, BASE, t)).toEqual([]);
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1));
    const cards = finderCards(rows, 11, BASE, t);
    expect(cards).toHaveLength(MAX_ROWS + 1);
    expect(summaryOf(cards[MAX_ROWS])).toEqual(["6 more prospects", "need you on the Prospects tab", `${BASE}/retailers?status=needs_owner`]);
    expect(finderCards(rows.slice(0, 3), 3, BASE, t)).toHaveLength(3);
  });
  it("in Telugu the row is in Telugu (the reason is ours, not the API's English)", () => {
    const te = appT("te");
    const cards = finderCards([parseProspect(PROSPECT_LOW)], 1, BASE, (k, v) => te(k as "frame.notyet", v));
    expect(summaryOf(cards[0])?.[1]).toBe("ఫిట్ 64 · స్టాక్ తక్కువ");
  });
  it("join Today's own cards through mergeDesk and add to the count, newest first", () => {
    const api: NeedsCard = { type: "item", key: "quote_approval-q1", at: "2026-10-27T03:00:00Z", item: { kind: "quote_approval", id: "q1", customer: "Ravi", city: null, agent: "quote_writer", summary: "x", at: "2026-10-27T03:00:00Z", amount_paise: null, href: "x" } };
    const today: TodayData = { ...NOTHING_TODAY, cards: { waiting: 1, money_held_paise: 0, orders_open: 0 }, needs: [api] };
    const finder = finderCards([row(5), row(4)], 2, BASE, t);
    const merged = mergeDesk(today, { needs: [...finder], team: [] });
    expect(merged.cards.waiting).toBe(3);
    // the customers' things first, then the new businesses, each newest first (owner, 5 Nov: a fresh search buried the quotes)
    expect(merged.needs?.map((c) => c.key)).toEqual(["quote_approval-q1", finder[0].key, finder[1].key]);
    expect(mergeDesk({ ...today, needs: null }, { needs: finder, team: [] }).cards.waiting).toBe(1);
  });
  it("the count is of things, not rows: the 'N more' row adds N (Lakshmi Silks test said 10 for 4 + 5 + 11 = 20)", () => {
    const api = (n: number): NeedsCard => ({ type: "item", key: `quote_approval-q${n}`, at: "2026-11-01T03:00:00Z", item: { kind: "quote_approval", id: `q${n}`, customer: "Ravi", city: null, agent: "quote_writer", summary: "x", at: "2026-11-01T03:00:00Z", amount_paise: null, href: "x" } });
    const today: TodayData = { ...NOTHING_TODAY, cards: { waiting: 4, money_held_paise: 0, orders_open: 0 }, needs: [api(1), api(2), api(3), api(4)] };
    const finder = finderCards(Array.from({ length: 5 }, (_, i) => row(i + 1)), 16, BASE, t);
    expect(finder).toHaveLength(6);
    expect(finder[5].type === "item" && finder[5].item.count).toBe(11);
    const merged = mergeDesk(today, { needs: finder, team: [] });
    expect(merged.cards.waiting).toBe(20);
    expect(merged.needs?.slice(0, 4).map((c) => c.key)).toEqual(["quote_approval-q1", "quote_approval-q2", "quote_approval-q3", "quote_approval-q4"]);
  });
  it("a row says where and how good, with 'Needs OK' for the first calls (owner, 5 Nov), and the opened card keeps the whole line", () => {
    const [first] = finderCards([row(1, { area: "Jayanagar", rating: 4.6, decision_reason: "first_calls", fit_score: 93 })], 1, BASE, t);
    expect(first.type === "item" && first.item).toMatchObject({ rowLine: "Jayanagar · 4.6★ · fit 93", summary: "fit 93 · 1 of the first 10 calls — needs your OK", prospect: { area: "Jayanagar", rating: 4.6, needsOk: true } });
    const [low] = finderCards([parseProspect(PROSPECT_LOW)], 1, BASE, t);
    expect(low.type === "item" && low.item.prospect?.needsOk).toBe(false);
    expect(low.type === "item" && low.item.rowLine).toMatch(/low stock$/);
  });
});

describe("reading them", () => {
  it("asks for the first page of needs_owner and the count", async () => {
    const cards = await readFinderNeeds(CTX, "sales", ON, BASE, t);
    expect(listProspects).toHaveBeenCalledWith("tok", "T", { status: "needs_owner", limit: MAX_ROWS });
    expect(cards).toHaveLength(1);
  });
  it.each([["a viewer", "viewer", { available: true, source: "fixture", reason: "ok" }], ["a school", "owner", { available: false, source: null, reason: "not_for_this_business" }], ["switched off", "owner", { available: false, source: null, reason: "switched_off" }], ["cannot tell", "owner", null], ["a Lead Desk plan (the API says so)", "owner", { available: false, source: null, reason: "not_in_plan" }]] as const)("%s: nothing, and nothing is asked", async (_, role, availability) => {
    expect(await readFinderNeeds(CTX, role, finderAccess(availability, true), BASE, t)).toEqual([]);
    expect(listProspects).not.toHaveBeenCalled();
  });
  it("a list that cannot be read adds nothing; a count that cannot be read falls back to the rows; a rejected session is thrown", async () => {
    listProspects.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readFinderNeeds(CTX, "owner", ON, BASE, t)).toEqual([]);
    getProspectStats.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readFinderNeeds(CTX, "owner", ON, BASE, t)).toHaveLength(1);
    listProspects.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(readFinderNeeds(CTX, "owner", ON, BASE, t)).rejects.toBeInstanceOf(ApiAuthError);
  });
});

describe("a Lead Desk plan (owner decision 4 Nov: the Lead Finder is part of AI Workforce)", () => {
  it("no row of the Lead Finder is read, even where the API would say available", async () => {
    expect(finderAccess({ available: true, source: "fixture", reason: "ok" }, false)).toBe("upsell");
    expect(await readFinderNeeds(CTX, "owner", "upsell", BASE, t)).toEqual([]);
    expect(listProspects).not.toHaveBeenCalled();
    expect(getProspectStats).not.toHaveBeenCalled();
  });
  it("ONE short row for the Owner and Admin that opens Settings -> Plan; Sales and a Viewer get none (they cannot change the plan)", () => {
    const card = finderUpsellCard("owner", `${BASE}/settings?section=plan`, t, "2026-11-04T05:00:00Z");
    expect(card).toMatchObject({ type: "item", key: "plan_upsell-lead_finder", item: { kind: "plan_upsell", customer: "Find new retailers near you", summary: "part of AI Workforce", href: `${BASE}/settings?section=plan` } });
    expect(finderUpsellCard("admin", `${BASE}/settings?section=plan`, t, "2026-11-04T05:00:00Z")).not.toBeNull();
    expect(finderUpsellCard("sales", null, t, "2026-11-04T05:00:00Z")).toBeNull();
    expect(finderUpsellCard("viewer", null, t, "2026-11-04T05:00:00Z")).toBeNull();
    const te = appT("te");
    expect((finderUpsellCard("owner", `${BASE}/settings?section=plan`, (k, v) => te(k as "frame.notyet", v), "2026-11-04T05:00:00Z") as Extract<NeedsCard, { type: "item" }>).item.customer).toBe(te("today.upsell.title"));
    expect(te("today.upsell.title")).not.toBe(en("today.upsell.title"));
  });
});
