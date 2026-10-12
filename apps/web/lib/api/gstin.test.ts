import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getBusinessProfile, putBusinessProfile, setCompanyGstin } from "./gstin";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
beforeEach(() => vi.clearAllMocks());

describe("the shop's GSTIN", () => {
  it("reads the number and its state; no number reads as none", async () => {
    apiRequest.mockResolvedValueOnce({ gstin: "27AAPFU0939F1ZV", state: "Maharashtra" });
    expect(await getBusinessProfile("tok", T)).toEqual({ gstin: "27AAPFU0939F1ZV", state: "Maharashtra" });
    apiRequest.mockResolvedValueOnce({ gstin: null, state: null });
    expect(await getBusinessProfile("tok", T)).toEqual({ gstin: null, state: null });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/business-profile`, "tok");
  });
  it("saves a number, and removes it with null; the key is always sent", async () => {
    apiRequest.mockResolvedValue({ gstin: null, state: null });
    await putBusinessProfile("tok", T, "27AAPFU0939F1ZV");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/business-profile`, "tok", { method: "PUT", body: JSON.stringify({ gstin: "27AAPFU0939F1ZV" }) });
    await putBusinessProfile("tok", T, null);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/business-profile`, "tok", { method: "PUT", body: JSON.stringify({ gstin: null }) });
  });
  it("a number that is not text is a contract error", async () => {
    apiRequest.mockResolvedValue({ gstin: 12, state: null });
    await expect(getBusinessProfile("tok", T)).rejects.toThrow(ApiContractError);
  });
});

describe("a business customer's GSTIN", () => {
  it("sets it on the company with a PATCH (null removes it) and reads back what the server holds", async () => {
    apiRequest.mockResolvedValue({ id: C, gstin: "29AAGCB7383J1Z4" });
    expect(await setCompanyGstin("tok", T, C, "29 aagcb 7383 j1z4")).toBe("29AAGCB7383J1Z4");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/companies/${C}`, "tok", { method: "PATCH", body: JSON.stringify({ gstin: "29 aagcb 7383 j1z4" }) });
    apiRequest.mockResolvedValue({ id: C, gstin: null });
    expect(await setCompanyGstin("tok", T, C, null)).toBeNull();
  });
  it("refuses ids that are not uuids before asking", async () => {
    await expect(setCompanyGstin("tok", T, "x", null)).rejects.toThrow(ApiContractError);
    await expect(getBusinessProfile("tok", "x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
