import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import { parseTripList } from "@/lib/api/deliveries";
import { TRIP_JSON, TRIP_LIST_JSON, TRIP_PROBLEM_JSON } from "@/lib/api/deliveries-fixtures";
import { parseSummary } from "@/lib/api/ledger";
import { SUMMARY_JSON } from "@/lib/api/ledger-fixtures";
import { parseQuoteList } from "@/lib/api/materials";
import { QUOTE_LIST_JSON } from "@/lib/api/materials-fixtures";
import { formatRupees } from "@/lib/money";

const api = { trips: vi.fn(), quotes: vi.fn(), dues: vi.fn(), report: vi.fn(), campaigns: vi.fn(), visits: vi.fn() };
vi.mock("@/lib/api/deliveries", async (o) => ({ ...(await o<typeof import("@/lib/api/deliveries")>()), listTrips: (...a: unknown[]) => api.trips(...a) }));
vi.mock("@/lib/api/materials", async (o) => ({ ...(await o<typeof import("@/lib/api/materials")>()), listMaterialQuotes: (...a: unknown[]) => api.quotes(...a) }));
vi.mock("@/lib/api/ledger", async (o) => ({ ...(await o<typeof import("@/lib/api/ledger")>()), getLedgerSummary: (...a: unknown[]) => api.dues(...a) }));

vi.mock("@/lib/api/reports", async (o) => ({ ...(await o<typeof import("@/lib/api/reports")>()), runReport: (...a: unknown[]) => api.report(...a) }));
vi.mock("@/lib/api/campaigns", async (o) => ({ ...(await o<typeof import("@/lib/api/campaigns")>()), listCampaigns: (...a: unknown[]) => api.campaigns(...a) }));
vi.mock("@/lib/api/visits", async (o) => ({ ...(await o<typeof import("@/lib/api/visits")>()), listVisits: (...a: unknown[]) => api.visits(...a) }));

import { parseCampaignList } from "@/lib/api/campaigns";
import { LIST_JSON } from "@/lib/api/campaigns-fixtures";
import { TODAY_REPORT_JSON } from "@/lib/api/education-fixtures";
import { parseReport } from "@/lib/api/reports";

import { readPackCards } from "./pack-cards";

const T = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-06T10:00:00+05:30");
const input = (modules: string[], role: "owner" | "admin" | "sales" | "viewer" = "owner") => ({ accessToken: "tok", tenantId: T, role, pack: { modules }, now: NOW, formatMoney: formatRupees });
beforeEach(() => {
  vi.clearAllMocks();
  api.trips.mockResolvedValue(parseTripList(TRIP_LIST_JSON));
  api.quotes.mockResolvedValue(parseQuoteList(QUOTE_LIST_JSON));
  api.dues.mockResolvedValue(parseSummary(SUMMARY_JSON));
  api.report.mockResolvedValue(parseReport(TODAY_REPORT_JSON));
  api.campaigns.mockResolvedValue(parseCampaignList({ ...LIST_JSON, items: LIST_JSON.items.filter((c) => c.status === "running") }));
  api.visits.mockResolvedValue({ from: "2026-10-06", to: "2026-10-06", items: [{ status: "confirmed" }, { status: "cancelled" }, { status: "arrived" }, { status: "no_show" }] });
});

describe("the cards a business type adds to Today", () => {
  it("construction: today's trips, quotes waiting and what falls due this week, each from its own module", async () => {
    const cards = await readPackCards(input(["deliveries", "materials", "dues"]));
    expect(cards.map((c) => c.id)).toEqual(["trips", "quotes", "dues"]);
    expect(cards[0]).toMatchObject({ value: "2", subVars: { moving: 1, done: 0, problems: 0 } });
    expect(cards[1]).toMatchObject({ value: "1", tone: "amber" });
    expect(cards[2].value).toBe("₹80,000.00");
    expect(cards[2]).toMatchObject({ tone: "red", subVars: { amount: "₹50,000.00" } });
    expect(api.trips).toHaveBeenCalledWith("tok", T, { date: "2026-10-06" });
  });
  it("a school: what was collected today, the reminder campaigns running and the campus visits of the day", async () => {
    const cards = await readPackCards(input(["fees", "dues", "programmes", "campaigns", "visits"]));
    expect(cards.map((c) => c.id)).toEqual(["collection", "reminders", "campus"]);
    expect(cards[0]).toMatchObject({ value: "₹37,000.00", subKey: "today.pack.collection.sub", subVars: { n: 4 }, href: `/app/tenants/${T}/fees` });
    expect(cards[1]).toMatchObject({ value: "1", subKey: "today.pack.reminders.sub" });
    expect(cards[2]).toMatchObject({ value: "2", subKey: "today.pack.campus.sub" });
    expect(api.report).toHaveBeenCalledWith("tok", T, "education.today");
    expect(api.campaigns).toHaveBeenCalledWith("tok", T, { status: "running", limit: 50 });
    expect(api.visits).toHaveBeenCalledWith("tok", T, { from: "2026-10-06", to: "2026-10-06" });
  });
  it("Sales do not see the reminder card; a card whose read fails says so and does not blank the rest", async () => {
    expect((await readPackCards(input(["fees", "programmes", "campaigns", "visits"], "sales"))).map((c) => c.id)).toEqual(["collection", "campus"]);
    api.report.mockRejectedValue(new Error("down"));
    const cards = await readPackCards(input(["fees", "programmes", "visits"]));
    expect(cards.map((c) => [c.id, c.value])).toEqual([["collection", null], ["campus", "2"]]);
  });
  it("a card exists only for a module the business type has", async () => {
    expect((await readPackCards(input(["deliveries"]))).map((c) => c.id)).toEqual(["trips"]);
    expect(await readPackCards(input(["today", "inbox"]))).toEqual([]);
    expect(api.quotes).not.toHaveBeenCalled();
    expect(api.dues).not.toHaveBeenCalled();
  });
  it("a business with fees shows the fee cards, not the dues card (the ledger is the same, the words are not)", async () => {
    expect((await readPackCards(input(["dues", "fees"]))).map((c) => c.id)).not.toContain("dues");
  });
  it("no pack, or a Viewer: no card and no read", async () => {
    expect(await readPackCards({ ...input(["deliveries"]), pack: null })).toEqual([]);
    expect(await readPackCards(input(["deliveries"], "viewer"))).toEqual([]);
    expect(api.trips).not.toHaveBeenCalled();
  });
  it("a read that fails leaves a card that says so; the others still show", async () => {
    api.trips.mockRejectedValue(new Error("boom"));
    const cards = await readPackCards(input(["deliveries", "materials"]));
    expect(cards.find((c) => c.id === "trips")).toMatchObject({ value: null, subKey: null });
    expect(cards.find((c) => c.id === "quotes")?.value).toBe("1");
  });
  it("a rejected session is thrown, not hidden", async () => {
    api.dues.mockRejectedValue(new ApiAuthError("x"));
    await expect(readPackCards(input(["dues"]))).rejects.toThrow(ApiAuthError);
  });
  it("a problem on a trip turns the card red and says so", async () => {
    api.trips.mockResolvedValue(parseTripList({ items: [TRIP_JSON, TRIP_PROBLEM_JSON] }));
    expect((await readPackCards(input(["deliveries"])))[0]).toMatchObject({ tone: "red", subKey: "today.pack.trips.problem", subVars: { problems: 1 } });
  });
  it("Sales sees quotes as drafts that wait for someone else", async () => {
    expect((await readPackCards(input(["materials"], "sales")))[0].subKey).toBe("today.pack.quotes.sales");
  });
});
