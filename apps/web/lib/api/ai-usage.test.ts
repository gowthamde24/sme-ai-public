import { beforeEach, describe, expect, it, vi } from "vitest";
import { pace } from "@/lib/plan-words";

import { ApiContractError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { AI_PAUSED_CODE, getAiUsage, parseAiUsage, pausedUntil } from "./ai-usage";

const TENANT = "22222222-2222-4222-8222-222222222222";
const USAGE = { today_percent: 83, month_percent: 12, resets_at_today: "2026-10-09T18:30:00Z", resets_at_month: "2026-11-08T18:30:00Z", state: "warn" };

beforeEach(() => vi.clearAllMocks());

describe("AI usage", () => {
  it("parses the contract's shape exactly and carries nothing else", () => {
    expect(parseAiUsage(USAGE)).toEqual(USAGE);
    expect(parseAiUsage({ ...USAGE, spent_paise: 5000 })).toEqual(USAGE);
  });
  it.each(["ok", "warn", "light", "paused"])("the state %s is part of the contract (light = over 100 %%, paused = 300 %%)", (state) => {
    expect(parseAiUsage({ ...USAGE, state }).state).toBe(state);
  });
  it.each([
    ["today_percent", 101], ["today_percent", -1], ["today_percent", 12.5], ["today_percent", "9"], ["today_percent", null],
    ["month_percent", 101], ["month_percent", true], ["resets_at_today", "soon"], ["resets_at_today", 5], ["resets_at_month", undefined],
    ["state", "sleeping"], ["state", undefined],
  ])("%s = %j is a contract error", (key, value) => {
    expect(() => parseAiUsage({ ...USAGE, [key]: value })).toThrow(ApiContractError);
  });
  it.each([[null], ["x"], [[]], [5]])("a non-object (%j) is a contract error", (json) => {
    expect(() => parseAiUsage(json)).toThrow(ApiContractError);
  });
  it("reads through the API client with the caller's token", async () => {
    apiRequest.mockResolvedValueOnce(USAGE);
    await expect(getAiUsage("tok", TENANT)).resolves.toEqual(USAGE);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/ai-usage`, "tok");
    await expect(getAiUsage("tok", "nope")).rejects.toThrow(ApiContractError);
  });
});

describe("pausedUntil", () => {
  it("returns the time of an ai_paused_until refusal", () => {
    expect(pausedUntil(new ApiRequestError(429, AI_PAUSED_CODE, "paused", undefined, "2026-11-08T18:30:00Z"))).toBe("2026-11-08T18:30:00Z");
  });
  it("is null for anything else", () => {
    expect(pausedUntil(new ApiRequestError(429, "run_limit_reached", "x"))).toBeNull();
    expect(pausedUntil(new ApiRequestError(409, AI_PAUSED_CODE, "x", undefined, "2026-11-08T18:30:00Z"))).toBeNull();
    expect(pausedUntil(new ApiRequestError(429, AI_PAUSED_CODE, "x", undefined, "not a time"))).toBeNull();
    expect(pausedUntil(new ApiRequestError(429, AI_PAUSED_CODE, "x"))).toBeNull();
    expect(pausedUntil(new Error("x"))).toBeNull();
  });
});

describe("plan and usage in plain words (app v4 part 8)", () => {
  const RESETS = "2026-12-01T00:00:00Z"; // the window began 1 November
  const day = (n: number) => Date.parse("2026-11-01T00:00:00Z") + n * 86_400_000;
  it("says nothing until 3 days have passed and some minutes were used", () => {
    expect(pace(10, 300, RESETS, day(2.9))).toEqual({ kind: "too_early" });
    expect(pace(0, 300, RESETS, day(10))).toEqual({ kind: "too_early" });
    expect(pace(10, 300, "not a date", day(10))).toEqual({ kind: "too_early" });
  });
  it("the days left are rounded down: 212 of 300 in 20 days is 10.6 a day, 88 left is 8.3 days", () => {
    expect(pace(212, 300, RESETS, day(20))).toEqual({ kind: "days", days: 8 });
  });
  it("when the minutes last to the end of the window it says so; when they are all used it says that", () => {
    expect(pace(30, 300, RESETS, day(10))).toEqual({ kind: "enough" });
    expect(pace(300, 300, RESETS, day(10))).toEqual({ kind: "none" });
    expect(pace(310, 300, RESETS, day(10))).toEqual({ kind: "none" });
  });
});
