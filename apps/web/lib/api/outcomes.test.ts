import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCustomerOutcomes, getOutcomeTotals, parseCustomerOutcome, parseTotals, postOutcomeCorrection } from "./outcomes";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

const examples = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "contracts", "outcomes.examples.json"), "utf8"));
const T = "22222222-2222-2222-2222-222222222222";
const LEAD = "7a2d4b63-1a1f-4c7f-8e8b-2b3c4d5e6f02";

beforeEach(() => request.mockReset());

describe("the outcomes API (C1's contract, job DO)", () => {
  it("reads C1's own example of a customer's outcomes: an unclear one has no category and no reason", () => {
    const list = examples.customer_outcomes.map(parseCustomerOutcome);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0]).toMatchObject({ result: "unclear", category: null, reason: null, corrected: false });
    expect(list.some((o: { corrected: boolean }) => o.corrected)).toBe(true);
  });
  it("refuses an outcome that is not in the closed lists (never drawn)", () => {
    const ok = examples.customer_outcomes[1];
    for (const bad of [{ ...ok, result: "great" }, { ...ok, category: "other" }, { ...ok, channel: "sms" }, { ...ok, id: "<b>" }, { ...ok, at: "yesterday" }, { ...ok, reason: 5 }, { ...ok, corrected: "yes" }, null, "x"]) expect(() => parseCustomerOutcome(bad)).toThrow();
  });
  it("totals: the counts of the day, and 'not interested' as the one category of the negative ones", () => {
    expect(parseTotals(examples.totals_today)).toEqual({ positive: 3, negative: 2, unclear: 1, notInterested: 1 });
    expect(parseTotals(examples.totals_empty_day)).toEqual({ positive: 0, negative: 0, unclear: 0, notInterested: 0 });
    expect(() => parseTotals({ total: { positive: -1, negative: 0, unclear: 0 } })).toThrow();
    expect(() => parseTotals({})).toThrow();
  });
  it("asks for a customer's outcomes and today's totals with the person's token, for ids that are real", async () => {
    request.mockResolvedValueOnce(examples.customer_outcomes);
    expect((await getCustomerOutcomes("tok", T, LEAD)).length).toBe(examples.customer_outcomes.length);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/customers/${LEAD}/outcomes?limit=20`, "tok");
    request.mockResolvedValueOnce(examples.totals_today);
    await getOutcomeTotals("tok", T);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/outcomes/totals`, "tok");
    await expect(getCustomerOutcomes("tok", "x", LEAD)).rejects.toThrow();
    await expect(getCustomerOutcomes("tok", T, "../x")).rejects.toThrow();
    request.mockResolvedValueOnce({ not: "a list" });
    await expect(getCustomerOutcomes("tok", T, LEAD)).rejects.toThrow();
  });
  it("posts a correction as {result, category}; an unclear one may have no category", async () => {
    request.mockResolvedValue(null);
    await postOutcomeCorrection("tok", T, "6f1c3a52-0f0e-4b6e-9d7a-1a2b3c4d5e02", "negative", "not_interested");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/outcomes/6f1c3a52-0f0e-4b6e-9d7a-1a2b3c4d5e02/correct`, "tok", { method: "POST", body: JSON.stringify({ result: "negative", category: "not_interested" }) });
    await postOutcomeCorrection("tok", T, "6f1c3a52-0f0e-4b6e-9d7a-1a2b3c4d5e03", "unclear", null);
    expect(JSON.parse(request.mock.calls.at(-1)![2].body)).toEqual({ result: "unclear", category: null });
    await expect(postOutcomeCorrection("tok", T, "../x", "unclear", null)).rejects.toThrow();
  });
});
