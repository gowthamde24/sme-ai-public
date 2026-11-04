import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";

import {
  actOnProspects,
  approveSearch,
  cancelSearch,
  getFinderSettings,
  getProspectStats,
  listProspects,
  listSearches,
  parseAvailability,
  parsePracticeCall,
  parseProspect,
  parseSearch,
  planSearch,
  practiceCall,
  readAvailability,
  redecideProspects,
  saveFinderSettings,
} from "./lead-finder";
import { PROSPECT, PRACTICE, SEARCH_DONE, SEARCH_PLANNED, SETTINGS, T, P1, P2, S1 } from "./lead-finder-fixtures";

beforeEach(() => request.mockReset());

describe("availability (contract section 0)", () => {
  it("reads the three closed fields", () => {
    expect(parseAvailability({ available: true, source: "fixture", reason: "ok" })).toEqual({ available: true, source: "fixture", reason: "ok" });
    expect(parseAvailability({ available: false, source: null, reason: "not_for_this_business" })).toEqual({ available: false, source: null, reason: "not_for_this_business" });
  });
  it.each([[{ available: "yes", source: null, reason: "ok" }], [{ available: true, source: "yelp", reason: "ok" }], [{ available: true, source: "places", reason: "maybe" }], [null]])("refuses %j", (body) => {
    expect(() => parseAvailability(body)).toThrow(ApiContractError);
  });
  it("a school's 403 is 'not available', any other failure is 'cannot tell' (null), a rejected session is thrown", async () => {
    request.mockRejectedValueOnce(new ApiRequestError(403, "lead_finder_not_available", "x"));
    expect(await readAvailability("tok", T)).toEqual({ available: false, source: null, reason: "not_for_this_business" });
    request.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await readAvailability("tok", T)).toBeNull();
    request.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readAvailability("tok", T)).toBeNull();
    request.mockResolvedValueOnce({ available: true, source: "nope", reason: "ok" });
    expect(await readAvailability("tok", T)).toBeNull();
    request.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(readAvailability("tok", T)).rejects.toBeInstanceOf(ApiAuthError);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/lead-finder/availability`, "tok");
  });
});

describe("searches (contract sections 1 and 2)", () => {
  it("reads a plan card and a result card (absent count keys are 0)", () => {
    const plan = parseSearch(SEARCH_PLANNED);
    expect(plan).toMatchObject({ state: "planned", query: "saree shops", area: "Jayanagar Bengaluru", maxResults: 20, provider: "fixture", estCostPaise: 0, costIsEstimate: false, searchesLeftToday: 5, attribution: null, counts: null });
    const done = parseSearch(SEARCH_DONE);
    expect(done.counts).toMatchObject({ found: 20, new: 18, call_ready: 0, needs_owner: 11, skipped: 7, researching: 0, duplicate_suppressed: 0 });
    expect(parseSearch({ ...SEARCH_DONE, counts: { new: 3 } }).counts).toMatchObject({ new: 3, call_ready: 0, skipped: 0 });
  });
  it.each([
    ["a state outside the list", { state: "running" }],
    ["a provider outside the list", { provider: "justdial" }],
    ["too many results", { max_results: 21 }],
    ["a negative cost", { est_cost_paise: -1 }],
    ["a category outside the list", { category_hint: "school" }],
    ["a count that is not a number", { counts: { new: "18" } }],
    ["a bad id", { id: "x" }],
    ["a query that floods the page", { query: "x".repeat(301) }],
  ])("refuses %s", (_, change) => {
    expect(() => parseSearch({ ...SEARCH_PLANNED, ...change })).toThrow(ApiContractError);
  });
  it("plans from the owner's words (trimmed, with the language) or from a query and an area, and refuses empty words before any call", async () => {
    request.mockResolvedValue(SEARCH_PLANNED);
    await planSearch("tok", T, { text: "  find new retailers in Jayanagar ", language: "te" });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-finder/plan`, "tok", { method: "POST", body: JSON.stringify({ text: "find new retailers in Jayanagar", language: "te" }) });
    await planSearch("tok", T, { text: "find boutiques in Guntur", language: "xx" });
    expect(JSON.parse(request.mock.lastCall![2].body)).toEqual({ text: "find boutiques in Guntur", language: "en" });
    await planSearch("tok", T, { query: "saree shops", area: "Jayanagar Bengaluru", maxResults: 50 });
    expect(JSON.parse(request.mock.lastCall![2].body)).toEqual({ query: "saree shops", area: "Jayanagar Bengaluru", max_results: 20 });
    request.mockClear();
    await expect(planSearch("tok", T, { text: " a ", language: "en" })).rejects.toBeInstanceOf(ApiContractError);
    await expect(planSearch("tok", "../x", { text: "find shops in Eluru", language: "en" })).rejects.toBeInstanceOf(ApiContractError);
    expect(request).not.toHaveBeenCalled();
  });
  it("approves, cancels and lists by id; a bad id never reaches the API", async () => {
    request.mockResolvedValue(SEARCH_DONE);
    expect((await approveSearch("tok", T, S1)).state).toBe("done");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-finder/searches/${S1}/approve`, "tok", { method: "POST", body: "{}" });
    request.mockResolvedValue({ ...SEARCH_PLANNED, state: "cancelled" });
    expect((await cancelSearch("tok", T, S1)).state).toBe("cancelled");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-finder/searches/${S1}/cancel`, "tok", { method: "POST", body: "{}" });
    request.mockResolvedValue({ items: [SEARCH_DONE] });
    expect(await listSearches("tok", T, 500)).toHaveLength(1);
    expect(request.mock.lastCall![0]).toBe(`/v1/tenants/${T}/lead-finder/searches?limit=100`);
    request.mockClear();
    await expect(approveSearch("tok", T, "../../admin")).rejects.toBeInstanceOf(ApiContractError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("prospects (contract section 3)", () => {
  it("reads a prospect with its decision, stock match and source", () => {
    const p = parseProspect(PROSPECT);
    expect(p).toMatchObject({ name: "Sri Lakshmi Sarees", status: "needs_owner", decisionReason: "first_calls", fitScore: 82, source: "fixture", attribution: null, stockMatch: { matched: ["Kanchi Pattu Bridal"], low: ["Soft Silk Daily"], enough: true }, qualification: null });
  });
  it("reads a qualification after a call (unknown captured keys are left out; a price may be null)", () => {
    const p = parseProspect({ ...PROSPECT, status: "qualified", lead_id: P2, qualification: { summary: "Sells silk sarees.", captured: { sells: "silk sarees", other: "x" }, language: "te", whatsapp_ok: true, callback: false, pitched: ["Kanchi Pattu Bridal"], quote_suggestion: [{ item: "Kanchi Pattu Bridal", unit: "piece", price_paise: null, moq: null, quantity_said: "20 a month" }], simulated: true } });
    expect(p.qualification).toEqual({ summary: "Sells silk sarees.", captured: { sells: "silk sarees" }, language: "te", whatsappOk: true, callback: false, pitched: ["Kanchi Pattu Bridal"], quoteSuggestion: [{ item: "Kanchi Pattu Bridal", unit: "piece", pricePaise: null, moq: null, quantitySaid: "20 a month" }], simulated: true });
  });
  it.each([
    ["a status outside the list", { status: "hot" }],
    ["a reason outside the list", { decision_reason: "because" }],
    ["a fit over 100", { fit_score: 101 }],
    ["a rating over 5", { rating: 7 }],
    ["a blank name", { name: "  " }],
    ["a source outside the list", { source: "indiamart_scrape" }],
    ["a qualification that is not simulated", { qualification: { summary: "", simulated: false } }],
    ["a stock match that is not a list", { stock_match: { matched: "all", low: [], enough: true } }],
  ])("refuses %s", (_, change) => {
    expect(() => parseProspect({ ...PROSPECT, ...change })).toThrow(ApiContractError);
  });
  it("lists best fit first with the status filter and the cursor; reads the stats", async () => {
    request.mockResolvedValue({ items: [PROSPECT], next_cursor: "c2" });
    const page = await listProspects("tok", T, { status: "needs_owner", cursor: "c1", limit: 5 });
    expect(page.nextCursor).toBe("c2");
    const url = new URL(`https://x${request.mock.lastCall![0]}`);
    expect(url.pathname).toBe(`/v1/tenants/${T}/prospects`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "5", status: "needs_owner", cursor: "c1" });
    await expect(listProspects("tok", T, { status: "hot" as never })).rejects.toBeInstanceOf(ApiContractError);
    request.mockResolvedValue({ total: 18, by_status: { needs_owner: 11, skipped: 7, weird: 2 } });
    expect(await getProspectStats("tok", T)).toEqual({ total: 18, byStatus: { needs_owner: 11, skipped: 7 } });
    request.mockResolvedValue({ items: "nope", next_cursor: null });
    await expect(listProspects("tok", T)).rejects.toBeInstanceOf(ApiContractError);
  });
});

describe("bulk buttons and redecide (contract section 4)", () => {
  it("sends the ids and the action, and reads one result per id", async () => {
    request.mockResolvedValue({ results: [{ id: P1, ok: true, status: "call_ready", error: null }, { id: P2, ok: false, status: null, error: "prospect_state" }] });
    expect(await actOnProspects("tok", T, [P1, P2], "call")).toEqual([{ id: P1, ok: true, status: "call_ready", error: null }, { id: P2, ok: false, status: null, error: "prospect_state" }]);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/prospects/actions`, "tok", { method: "POST", body: JSON.stringify({ ids: [P1, P2], action: "call" }) });
    request.mockResolvedValue({ results: [{ id: P1, ok: false, status: null, error: "exploded" }] });
    await expect(actOnProspects("tok", T, [P1], "skip")).rejects.toBeInstanceOf(ApiContractError);
  });
  it("refuses no ids, more than 50, a repeated id, a bad id or an unknown action before any call", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const [ids, action] of [[[], "call"], [many, "call"], [[P1, P1], "call"], [["x"], "call"], [[P1], "dial"]] as const) await expect(actOnProspects("tok", T, ids, action as never)).rejects.toBeInstanceOf(ApiContractError);
    expect(request).not.toHaveBeenCalled();
  });
  it("redecide is one POST and answers how many changed", async () => {
    request.mockResolvedValue({ changed: 3 });
    expect(await redecideProspects("tok", T)).toBe(3);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/prospects/redecide`, "tok", { method: "POST", body: "{}" });
  });
});

describe("the practice call (contract section 5)", () => {
  it("sends the persona and the language and reads the simulated call", async () => {
    request.mockResolvedValue(PRACTICE);
    const c = await practiceCall("tok", T, P1, "interested", "te");
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/prospects/${P1}/simulated-call`, "tok", { method: "POST", body: JSON.stringify({ persona: "interested", language: "te" }) });
    expect(c).toMatchObject({ simulated: true, outcome: "qualified", language: "te", transcript: [{ who: "assistant", t: 0 }, { who: "business", t: 4.5 }] });
    expect(c.quoteSuggestion.map((q) => [q.item, q.pricePaise, q.moq])).toEqual([["Kanchi Pattu Bridal", 1850000, 2], ["Dharmavaram Silk Classic", null, null]]);
  });
  it.each([["not simulated", { simulated: false }], ["an outcome outside the list", { outcome: "sold" }], ["a turn by somebody else", { transcript: [{ who: "operator", text: "hi", t: 0 }] }], ["a language outside the list", { language: "hi" }]])("refuses %s", (_, change) => {
    expect(() => parsePracticeCall({ ...PRACTICE, ...change })).toThrow(ApiContractError);
  });
  it("refuses an unknown persona before any call", async () => {
    await expect(practiceCall("tok", T, P1, "angry" as never, "en")).rejects.toBeInstanceOf(ApiContractError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("settings (contract section 6)", () => {
  it("reads them and saves a subset with the API's names", async () => {
    request.mockResolvedValue(SETTINGS);
    expect(await getFinderSettings("tok", T)).toEqual({ fitBar: 70, dailyCallCap: 20, callFromHour: 10, callToHour: 19, searchesPerDay: 5, resultsPerSearch: 20, updatedAt: null });
    await saveFinderSettings("tok", T, { fitBar: 75, callToHour: 18 });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/lead-finder/settings`, "tok", { method: "PUT", body: JSON.stringify({ fit_bar: 75, call_to_hour: 18 }) });
    await expect(saveFinderSettings("tok", T, {})).rejects.toBeInstanceOf(ApiContractError);
  });
  it("refuses a bar under 50 from the API", async () => {
    request.mockResolvedValue({ ...SETTINGS, fit_bar: 10 });
    await expect(getFinderSettings("tok", T)).rejects.toBeInstanceOf(ApiContractError);
  });
});
