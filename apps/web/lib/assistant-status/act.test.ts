import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
const set = vi.fn();
vi.mock("@/lib/api/client", async () => {
  class ApiRequestError extends Error {
    constructor(readonly status: number, readonly code: string, message = "x") {
      super(message);
    }
  }
  return { apiRequest: (...a: unknown[]) => apiRequest(...a), ApiRequestError };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (...a: unknown[]) => set(...a), get: () => undefined }) }));

import { ApiRequestError } from "@/lib/api/client";

import { actOnAssistant } from "./act";

const T = "22222222-2222-4222-8222-222222222222";
const LIVE = { state: "live", can_go_live: true, missing: [], using_defaults: ["voice"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASSISTANT_STATUS", "1");
});

describe("Go live and Pause", () => {
  it("off: nothing is asked and nothing is kept", async () => {
    vi.stubEnv("ASSISTANT_STATUS", "");
    expect(await actOnAssistant("tok", T, "go-live")).toEqual({ ok: false, error: "not_available" });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
  it("mock: the state goes into ONE cookie (live, or in training after a pause) and nothing is sent", async () => {
    vi.stubEnv("ASSISTANT_STATUS", "mock");
    expect(await actOnAssistant("tok", T, "go-live")).toMatchObject({ ok: true, status: { state: "live", usingDefaults: [] } });
    expect(set).toHaveBeenLastCalledWith("sme_assistant_state", "live", expect.objectContaining({ httpOnly: true }));
    expect(await actOnAssistant("tok", T, "pause")).toMatchObject({ ok: true, status: { state: "in_training" } });
    expect(set).toHaveBeenLastCalledWith("sme_assistant_state", "in_training", expect.anything());
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("1: POSTs to the contract's routes and returns the status it answers", async () => {
    apiRequest.mockResolvedValueOnce(LIVE);
    expect(await actOnAssistant("tok", T, "go-live")).toEqual({ ok: true, status: { state: "live", canGoLive: true, missing: [], usingDefaults: ["voice"] } });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/assistant/go-live`, "tok", { method: "POST" });
    apiRequest.mockResolvedValueOnce({ ...LIVE, state: "in_training" });
    await actOnAssistant("tok", T, "pause");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/pause`, "tok", { method: "POST" });
  });
  it("409 assistant_not_ready: the status is read again and says what is missing", async () => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(409, "assistant_not_ready", "x"));
    apiRequest.mockResolvedValueOnce({ state: "not_live", can_go_live: false, missing: ["phone_number"], using_defaults: [] });
    expect(await actOnAssistant("tok", T, "go-live")).toEqual({ ok: false, error: "not_ready", missing: ["phone_number"] });
  });
  it.each([
    [403, "forbidden"],
    [404, "not_available"],
    [500, "down"],
  ])("a %i is %s; an odd answer or an unreachable API is down", async (status, word) => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(status, "x", "x"));
    expect(await actOnAssistant("tok", T, "pause")).toEqual({ ok: false, error: word });
  });
  it("an odd answer is down, a bad workspace id is not asked", async () => {
    apiRequest.mockResolvedValueOnce({ nope: 1 });
    expect(await actOnAssistant("tok", T, "go-live")).toEqual({ ok: false, error: "down" });
    apiRequest.mockRejectedValueOnce(new Error("net"));
    expect(await actOnAssistant("tok", T, "go-live")).toEqual({ ok: false, error: "down" });
    expect(await actOnAssistant("tok", "nope", "go-live")).toEqual({ ok: false, error: "not_available" });
  });
});
