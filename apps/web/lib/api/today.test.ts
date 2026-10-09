import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { AGENT_KEYS, getAgentsStatus, getAiUsageToday, getToday, parseAgentsStatus, parseAiUsage, parseNeedsYouItem, parseRecentStep, parseToday } from "./today";

const TENANT = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-10-09T09:30:00Z";

const ITEM = { kind: "quote_approval", id: ID, customer: "Harbour Retail", city: "Hyderabad", agent: "quote_writer", summary: "Quote 3 for ₹5,000.00 is ready for your approval.", at: AT, amount_paise: 500_000 };
const STEP = { kind: "order_step", order_ref: "Order 4", customer: "Lakshmi Silks", text: "Order cancelled", at: AT };
const TODAY = { cards: { waiting: 1, money_held_paise: 40_000, orders_open: 2 }, needs_you: [ITEM], recent: [STEP] };
const AGENTS = AGENT_KEYS.map((agent, i) => ({ agent, state: i < 2 ? "not_available" : "idle", job: `Job of ${agent}`, last_event: i === 4 ? { text: "Prepared quote 3", at: AT } : null }));

beforeEach(() => vi.clearAllMocks());

describe("Today", () => {
  it("parses the contract's shape exactly", () => {
    expect(parseToday(TODAY)).toEqual(TODAY);
    expect(parseToday({ cards: { waiting: 0, money_held_paise: 0, orders_open: 0 }, needs_you: [], recent: [] }).needs_you).toEqual([]);
  });
  it("accepts a missing city and no amount", () => {
    expect(parseNeedsYouItem({ ...ITEM, city: null, amount_paise: null })).toMatchObject({ city: null, amount_paise: null });
  });
  it.each([
    ["kind", "other"], ["kind", 5], ["id", "x"], ["id", 5], ["customer", ""], ["customer", 3], ["agent", "main"], ["summary", ""], ["at", "yesterday"], ["at", 5],
    ["amount_paise", -1], ["amount_paise", 1.5], ["amount_paise", "5"], ["amount_paise", undefined], ["city", 5], ["city", undefined],
  ])("an item with %s = %j is a contract error", (key, value) => {
    expect(() => parseNeedsYouItem({ ...ITEM, [key]: value })).toThrow(ApiContractError);
  });
  it.each([["kind", "x"], ["order_ref", ""], ["customer", ""], ["text", ""], ["at", "soon"]])("a recent step with %s = %j is a contract error", (key, value) => {
    expect(() => parseRecentStep({ ...STEP, [key]: value })).toThrow(ApiContractError);
  });
  it.each([
    [null], ["x"], [[]], [{}], [{ ...TODAY, cards: null }], [{ ...TODAY, needs_you: {} }], [{ ...TODAY, recent: "no" }],
    [{ ...TODAY, cards: { ...TODAY.cards, waiting: -1 } }], [{ ...TODAY, cards: { ...TODAY.cards, money_held_paise: 1.5 } }], [{ ...TODAY, cards: { ...TODAY.cards, orders_open: "2" } }],
    [{ ...TODAY, cards: { waiting: 1, money_held_paise: 0 } }], [{ ...TODAY, recent: Array(6).fill(STEP) }],
  ])("%j is a contract error", (json) => {
    expect(() => parseToday(json)).toThrow(ApiContractError);
  });
  it("reads with the person's token from the tenant's own path (encoded)", async () => {
    apiRequest.mockResolvedValue(TODAY);
    expect(await getToday("tok", TENANT)).toEqual(TODAY);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/today`, "tok");
    await getToday("tok", "a/b?c");
    expect(apiRequest).toHaveBeenLastCalledWith("/v1/tenants/a%2Fb%3Fc/today", "tok");
  });
  it("shows nothing for an answer that does not match", async () => {
    apiRequest.mockResolvedValue({ cards: "oops" });
    await expect(getToday("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
});

describe("AI usage", () => {
  it("parses spent, cap and left in paise", () => {
    expect(parseAiUsage({ spent_paise: 15, cap_paise: 25_000, left_paise: 24_985 })).toEqual({ spent_paise: 15, cap_paise: 25_000, left_paise: 24_985 });
    expect(parseAiUsage({ spent_paise: 30_000, cap_paise: 25_000, left_paise: 0 }).left_paise).toBe(0);
  });
  it.each([[null], [{}], [{ spent_paise: -1, cap_paise: 5, left_paise: 5 }], [{ spent_paise: 0, cap_paise: 5.5, left_paise: 5 }], [{ spent_paise: 0, cap_paise: 5, left_paise: 6 }], [{ spent_paise: "0", cap_paise: 5, left_paise: 5 }]])(
    "%j is a contract error",
    (json) => expect(() => parseAiUsage(json)).toThrow(ApiContractError),
  );
  it("reads with the person's token", async () => {
    apiRequest.mockResolvedValue({ spent_paise: 0, cap_paise: 10, left_paise: 10 });
    await getAiUsageToday("tok", TENANT);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/ai-usage/today`, "tok");
  });
});

describe("the helpers' status", () => {
  it("is always all seven, in the contract's order", () => {
    expect(parseAgentsStatus(AGENTS).map((a) => a.agent)).toEqual(["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"]);
    expect(parseAgentsStatus(AGENTS)[4].last_event).toEqual({ text: "Prepared quote 3", at: AT });
  });
  it.each([
    ["six", AGENTS.slice(0, 6)], ["eight", [...AGENTS, AGENTS[0]]], ["a different order", [AGENTS[1], AGENTS[0], ...AGENTS.slice(2)]], ["not a list", {}],
    ["a bad state", AGENTS.map((a, i) => (i === 3 ? { ...a, state: "asleep" } : a))],
    ["an empty job", AGENTS.map((a, i) => (i === 3 ? { ...a, job: "" } : a))],
    ["a bad last_event", AGENTS.map((a, i) => (i === 3 ? { ...a, last_event: { text: "x" } } : a))],
    ["a missing last_event", AGENTS.map((a, i) => (i === 3 ? { agent: a.agent, state: a.state, job: a.job } : a))],
  ])("%s is a contract error", (_label, json) => {
    expect(() => parseAgentsStatus(json)).toThrow(ApiContractError);
  });
  it("reads with the person's token", async () => {
    apiRequest.mockResolvedValue(AGENTS);
    expect(await getAgentsStatus("tok", TENANT)).toHaveLength(7);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/agents/status`, "tok");
  });
});
