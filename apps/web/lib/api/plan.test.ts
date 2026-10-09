import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getPlan, parsePlan } from "./plan";

const TENANT = "22222222-2222-4222-8222-222222222222";
const BODY = { id: TENANT, name: "Acme", slug: "acme", role: "owner", plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-01T09:00:00Z" };
beforeEach(() => vi.clearAllMocks());

describe("the plan", () => {
  it("is read from the tenant response, the three fields only", () => {
    expect(parsePlan(BODY)).toEqual({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-01T09:00:00Z" });
  });
  it.each([
    [null], ["x"], [[]], [{}], [{ ...BODY, plan: "gold" }], [{ ...BODY, plan: undefined }], [{ ...BODY, workspace_limit: 0 }], [{ ...BODY, workspace_limit: 1.5 }], [{ ...BODY, workspace_limit: "1" }],
    [{ ...BODY, workspace_limit: 101 }], [{ ...BODY, trial_started_at: "yesterday" }], [{ ...BODY, trial_started_at: undefined }],
  ])("%j is a contract error", (json) => {
    expect(() => parsePlan(json)).toThrow(ApiContractError);
  });
  it("is read with the person's token from the tenant's own path", async () => {
    apiRequest.mockResolvedValue(BODY);
    expect(await getPlan("tok", TENANT)).toMatchObject({ plan: "free_trial", workspace_limit: 1 });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}`, "tok");
  });
  it("shows nothing for a tenant response without the plan", async () => {
    apiRequest.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
    await expect(getPlan("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
});
