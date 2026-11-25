import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchQuotes = vi.fn();
const fetchQuote = vi.fn();
const summaryEnquiry = vi.fn();
vi.mock("@/lib/api/quotes", () => ({ fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: (...a: unknown[]) => fetchQuote(...a) }));
vi.mock("@/lib/api/today-summary", () => ({ summaryEnquiry: (...a: unknown[]) => summaryEnquiry(...a) }));

const flag = vi.hoisted(() => ({ v: "on" as "off" | "mock" | "on" }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => flag.v }));

import { targetPaths } from "./target-path";

const T = "22222222-2222-4222-8222-222222222222";
const [Q_LISTED, Q_SUMMARY, Q_UNPLACED, Q_OLD] = ["a1111111-1111-4111-8111-111111111111", "a2222222-2222-4222-8222-222222222222", "a3333333-3333-4333-8333-333333333333", "a4444444-4444-4444-8444-444444444444"];
const [E_LISTED, E_SUMMARY, E_OLD] = ["b1111111-1111-4111-8111-111111111111", "b2222222-2222-4222-8222-222222222222", "b4444444-4444-4444-8444-444444444444"];
const quote = (id: string) => ({ type: "quote" as const, id });

beforeEach(() => {
  vi.clearAllMocks();
  fetchQuotes.mockResolvedValue([{ id: Q_LISTED, enquiry_id: E_LISTED }]);
  fetchQuote.mockImplementation(async (_t: string, _w: string, id: string) => ({ enquiry_id: id === Q_OLD ? E_OLD : "never" }));
});

describe("targetPaths: calls paused and a message sent back", () => {
  it("`calls` opens the Do-Not-Call list (the chats while JOBS is off); `message` opens Chats > Templates", async () => {
    const calls = { type: "calls" as const, id: T };
    const message = { type: "message" as const, id: T };
    flag.v = "on";
    const where = await targetPaths("tok", T, [calls, message]);
    expect(where(calls)).toBe(`/app/tenants/${T}/do-not-call`);
    expect(where(message)).toBe(`/app/tenants/${T}/chats/templates`);
    flag.v = "off";
    expect((await targetPaths("tok", T, [calls]))(calls)).toBe(`/app/tenants/${T}/chats`);
    flag.v = "on";
  });
});

describe("targetPaths: the phone assistant has no price list", () => {
  it("`price_list` opens the price list page of this workspace", async () => {
    const prices = { type: "price_list" as const, id: T };
    expect((await targetPaths("tok", T, [prices]))(prices)).toBe(`/app/tenants/${T}/price-list`);
  });
});

describe("targetPaths: the IndiaMART key was refused", () => {
  it("`lead_sources` opens Lead sources", async () => {
    const key = { type: "lead_sources" as const, id: T };
    expect((await targetPaths("tok", T, [key]))(key)).toBe(`/app/tenants/${T}/lead-sources`);
  });
});

describe("targetPaths: a quote opens its enquiry", () => {
  it("the newest 50 come from the list; an older one from the Today summary when it holds it; only what the summary does not hold is read one by one", async () => {
    summaryEnquiry.mockImplementation(async (_t: string, id: string) => (id === Q_SUMMARY ? E_SUMMARY : id === Q_UNPLACED ? null : undefined));
    const where = await targetPaths("tok", T, [quote(Q_LISTED), quote(Q_SUMMARY), quote(Q_UNPLACED), quote(Q_OLD)]);
    expect(where(quote(Q_LISTED))).toBe(`/app/tenants/${T}/enquiries/${E_LISTED}?quote=${Q_LISTED}`);
    expect(where(quote(Q_SUMMARY))).toBe(`/app/tenants/${T}/enquiries/${E_SUMMARY}?quote=${Q_SUMMARY}`);
    expect(where(quote(Q_UNPLACED))).toBe(`/app/tenants/${T}/quotes`); // (the API could not place it: the list of quotes)
    expect(where(quote(Q_OLD))).toBe(`/app/tenants/${T}/enquiries/${E_OLD}?quote=${Q_OLD}`);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    expect(fetchQuote).toHaveBeenCalledWith("tok", T, Q_OLD);
  });
  it("without the summary (undefined for all) every older quote is read as before", async () => {
    summaryEnquiry.mockResolvedValue(undefined);
    await targetPaths("tok", T, [quote(Q_OLD)]);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
  });
});
