import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { loadExampleData, removeExampleData } from "./example-data";
import { getProfile, parseProfile, saveProfile } from "./profile";
import { ApiContractError } from "./client";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("example data", () => {
  it("loads with POST and removes with DELETE, at the workspace's own path", async () => {
    apiRequest.mockResolvedValue(null);
    expect(await loadExampleData("tok", T)).toBe("ok");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/example-data`, "tok", { method: "POST" });
    expect(await removeExampleData("tok", T)).toBe("ok");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/example-data`, "tok", { method: "DELETE" });
  });
  it.each([[404, "unavailable"], [501, "unavailable"], [403, "refused"], [409, "refused"], [500, "failed"], [503, "failed"]])("a %i answer is '%s'", async (status, want) => {
    apiRequest.mockRejectedValue(new ApiRequestError(status, "x", "x"));
    expect(await loadExampleData("tok", T)).toBe(want);
  });
  it("passes a rejected session on, and calls any other failure 'failed'", async () => {
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(loadExampleData("tok", T)).rejects.toThrow(ApiAuthError);
    apiRequest.mockRejectedValueOnce(new Error("boom"));
    expect(await removeExampleData("tok", T)).toBe("failed");
  });
});

describe("the business profile", () => {
  it("reads the name, the town and whether the setup is complete; an empty town is no town", () => {
    expect(parseProfile({ name: "Acme", town: "Guntur", languages: ["en"], setup_complete: true })).toEqual({ name: "Acme", town: "Guntur", setupComplete: true });
    expect(parseProfile({ name: "Acme", town: "  ", setup_complete: false })).toEqual({ name: "Acme", town: null, setupComplete: false });
    expect(parseProfile({ name: "Acme", town: null })).toEqual({ name: "Acme", town: null, setupComplete: false });
  });
  it.each([[null], [[]], [{}], [{ name: "" }], [{ name: 4 }], [{ name: "x", town: 4 }]])("%j is a contract error", (json) => {
    expect(() => parseProfile(json)).toThrow(ApiContractError);
  });
  it("is read and saved with the person's token (PUT keeps what is left out)", async () => {
    apiRequest.mockResolvedValue({ name: "Acme", town: "Guntur", setup_complete: true });
    expect((await getProfile("tok", T)).town).toBe("Guntur");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/profile`, "tok");
    await saveProfile("tok", T, { name: "Acme", town: "Guntur" });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/profile`, "tok", { method: "PUT", body: JSON.stringify({ name: "Acme", town: "Guntur" }) });
  });
});
