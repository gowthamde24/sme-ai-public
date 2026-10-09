import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchAccountSetup, parseAccountSetup, parseSetupResult, submitAccountSetup } from "./account";

const TENANT = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("parsing", () => {
  it("reads the three states", () => {
    expect(parseAccountSetup({ state: "none", tenant_id: null, business_name: null })).toEqual({ state: "none", tenantId: null, businessName: null });
    expect(parseAccountSetup({ state: "needed", tenant_id: null, business_name: "Sri Lakshmi" })).toEqual({ state: "needed", tenantId: null, businessName: "Sri Lakshmi" });
    expect(parseAccountSetup({ state: "done", tenant_id: TENANT, business_name: null })).toEqual({ state: "done", tenantId: TENANT, businessName: null });
  });
  it.each([
    [null], ["x"], [[]], [{}],
    [{ state: "weird", tenant_id: null, business_name: null }],
    [{ state: "done", tenant_id: null, business_name: null }],
    [{ state: "needed", tenant_id: "nope", business_name: null }],
    [{ state: "needed", tenant_id: null, business_name: 5 }],
    [{ state: "needed", business_name: null }],
  ])("%j is a contract error", (json) => {
    expect(() => parseAccountSetup(json)).toThrow(ApiContractError);
  });
  it("reads a setup result", () => {
    expect(parseSetupResult({ tenant_id: TENANT, created: false })).toEqual({ tenantId: TENANT, created: false });
    for (const bad of [null, {}, { tenant_id: "x", created: true }, { tenant_id: TENANT, created: "yes" }]) {
      expect(() => parseSetupResult(bad)).toThrow(ApiContractError);
    }
  });
});

describe("the calls", () => {
  it("reads the setup with the person's token", async () => {
    apiRequest.mockResolvedValue({ state: "none", tenant_id: null, business_name: null });
    expect((await fetchAccountSetup("tok")).state).toBe("none");
    expect(apiRequest).toHaveBeenCalledWith("/v1/account/setup", "tok");
  });
  it("posts exactly the two choices, snake_cased, and nothing else", async () => {
    apiRequest.mockResolvedValue({ tenant_id: TENANT, created: true });
    expect(await submitAccountSetup("tok", { businessType: "textiles", language: "te" })).toEqual({ tenantId: TENANT, created: true });
    const [path, token, init] = apiRequest.mock.calls[0];
    expect([path, token, init.method]).toEqual(["/v1/account/setup", "tok", "POST"]);
    expect(JSON.parse(init.body)).toEqual({ business_type: "textiles", language: "te" });
  });
  it("a body that does not match is an error, never used", async () => {
    apiRequest.mockResolvedValue({ tenant_id: "x" });
    await expect(submitAccountSetup("tok", { businessType: "other", language: "en" })).rejects.toThrow(ApiContractError);
  });
});
