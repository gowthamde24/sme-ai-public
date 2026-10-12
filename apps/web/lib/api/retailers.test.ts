import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
const apiStreamRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiStreamRequest: (...a: unknown[]) => apiStreamRequest(...a) }));

import { confirmPlace, getResearchStatus, mapsLink, parseResearchStatus, queryProblem, questionOf, searchRetailers } from "./retailers";

const T = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const P1 = "3b1c0000-0000-4000-8000-000000000001";
const sse = (events: [string, unknown][]) => new Response(events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify({ type: n, ...(d as object) })}\n\n`).join(""), { status: 200 });
beforeEach(() => vi.clearAllMocks());

describe("the research status", () => {
  const tools = { web_search: { enabled: true, used_today: 4, daily_limit: 30 }, read_page: { enabled: false, used_today: null, daily_limit: null }, find_retailers: { enabled: true, used_today: 2, daily_limit: 10 }, metal_prices: { enabled: true, used_today: 1, daily_limit: 20 } };
  it("says which tools are on and how much of each day's limit is used", async () => {
    apiRequest.mockResolvedValue({ tools });
    const s = await getResearchStatus("tok", T);
    expect(s.find_retailers).toEqual({ enabled: true, used_today: 2, daily_limit: 10 });
    expect(s.read_page.enabled).toBe(false);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/research/status`, "tok");
  });
  it("a tool missing from the answer is a contract error", () => {
    expect(() => parseResearchStatus({ tools: { web_search: tools.web_search } })).toThrow(ApiContractError);
  });
});

describe("the question and its checks", () => {
  it("says 'retailers' (which is what offers the map tool) and puts the city in the same sentence", () => {
    expect(questionOf("saree wholesalers", "Guntur")).toBe("Find retailers: saree wholesalers in Guntur");
    expect(questionOf(" silk sarees ", " ")).toBe("Find retailers: silk sarees");
  });
  it("refuses a phone number, an e-mail address or a link before asking (the API would), and an empty or long one", () => {
    expect(queryProblem("saree shops", "Guntur")).toBeNull();
    expect(queryProblem("ab", "")).toBe("empty");
    expect(queryProblem("x".repeat(101), "")).toBe("too_long");
    expect(queryProblem("saree shop 9876543210", "")).toBe("contact_details");
    expect(queryProblem("shops", "a@b.test")).toBe("contact_details");
    expect(queryProblem("see https://x.test", "")).toBe("contact_details");
  });
  it("links only to Google Maps", () => {
    expect(mapsLink("https://maps.google.com/?cid=2")).toBe("https://maps.google.com/?cid=2");
    expect(mapsLink("https://www.google.com/maps/place/x")).toContain("google.com/maps");
    for (const bad of ["http://maps.google.com/?cid=2", "https://evil.test/?u=maps.google.com", "javascript:alert(1)", "https://maps.google.com.evil.test/x", null, 5]) expect(mapsLink(bad)).toBeNull();
  });
});

describe("searching", () => {
  it("keeps the place cards, the words of the answer, and nothing else from the stream", async () => {
    apiStreamRequest.mockResolvedValue(
      sse([
        ["text", { delta: "I found two shops (see the cards)." }],
        ["source", { kind: "place", id: P1, label: "Balaji Sarees", target: null, url: "https://maps.google.com/?cid=2" }],
        ["source", { kind: "web", id: "3b1c0000-0000-4000-8000-000000000002", label: "A page", target: null, url: "https://news.example/a" }],
        ["source", { kind: "place", id: "3b1c0000-0000-4000-8000-000000000003", label: "No Link Silks", target: null, url: "https://evil.test/x" }],
        ["done", { conversation_id: M, message_id: M, language: "en", kind: "answer" }],
      ]),
    );
    const r = await searchRetailers("tok", T, { messageId: M, text: "Find retailers: saree in Guntur" });
    expect(r.cards).toEqual([{ id: P1, label: "Balaji Sarees", url: "https://maps.google.com/?cid=2" }, { id: "3b1c0000-0000-4000-8000-000000000003", label: "No Link Silks", url: null }]);
    expect(r.text).toBe("I found two shops (see the cards).");
    expect(r.error).toBeNull();
    expect(apiStreamRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/assistant/messages`, "tok", { message_id: M, text: "Find retailers: saree in Guntur" });
  });
  it("shows at most ten cards", async () => {
    apiStreamRequest.mockResolvedValue(sse(Array.from({ length: 14 }, (_, i): [string, unknown] => ["source", { kind: "place", id: `3b1c0000-0000-4000-8000-${String(i).padStart(12, "0")}`, label: `Shop ${i}`, target: null, url: null }])));
    expect((await searchRetailers("tok", T, { messageId: M, text: "x" })).cards).toHaveLength(10);
  });
  it("an assistant refusal is a closed code, not a message", async () => {
    apiStreamRequest.mockResolvedValue(sse([["error", { code: "ai_paused_until", message: "SECRET internal text" }]]));
    const r = await searchRetailers("tok", T, { messageId: M, text: "x" });
    expect(r.error).toBe("ai_paused_until");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
  it("a place whose id is not a uuid is a contract error", async () => {
    apiStreamRequest.mockResolvedValue(sse([["source", { kind: "place", id: "nope", label: "x", target: null, url: null }]]));
    await expect(searchRetailers("tok", T, { messageId: M, text: "x" })).rejects.toThrow(ApiContractError);
  });
  it("refuses ids that are not uuids before asking", async () => {
    await expect(searchRetailers("tok", "x", { messageId: M, text: "x" })).rejects.toThrow(ApiContractError);
    expect(apiStreamRequest).not.toHaveBeenCalled();
  });
});

describe("saving a shop as a lead", () => {
  it("sends what the person typed and the card's id, and says whether it was new", async () => {
    apiRequest.mockResolvedValue({ company_id: P1, lead_id: M, created: true });
    const r = await confirmPlace("tok", T, { placeId: P1, companyName: " Balaji Sarees ", city: "Guntur", region: "" });
    expect(r).toEqual({ company_id: P1, lead_id: M, created: true });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/places/confirm`, "tok", { method: "POST", body: JSON.stringify({ place_id: P1, company_name: "Balaji Sarees", city: "Guntur" }) });
  });
  it("refuses a place id of the wrong shape", async () => {
    await expect(confirmPlace("tok", T, { placeId: "short", companyName: "x" })).rejects.toThrow(ApiContractError);
    await expect(confirmPlace("tok", T, { placeId: "a b c d e f g h i j", companyName: "x" })).rejects.toThrow(ApiContractError);
  });
});
