import { beforeEach, describe, expect, it, vi } from "vitest";

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
