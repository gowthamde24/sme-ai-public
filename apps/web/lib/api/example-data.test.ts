import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getExampleStatus, loadExampleData, removeExampleData } from "./example-data";
import { getProfile, parseProfile, saveProfile } from "./profile";
import { ApiContractError } from "./client";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.clearAllMocks());

const COUNTS = { companies: 2, contacts: 3, leads: 3, products: 4 };
const NONE = { companies: 0, contacts: 0, leads: 0, products: 0 };
const STATUS = { loaded: true, batch_id: "b1", pack_id: "p", loaded_at: "2026-10-01T00:00:00Z", removed_at: null, counts: COUNTS };

describe("example data", () => {
  it("asks whether the sample is loaded (GET), at the workspace's own path", async () => {
    apiRequest.mockResolvedValue(STATUS);
    expect(await getExampleStatus("tok", T)).toEqual({ loaded: true, counts: COUNTS });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/example-data`, "tok");
    apiRequest.mockResolvedValue({ ...STATUS, loaded: false, counts: NONE });
    expect((await getExampleStatus("tok", T))?.loaded).toBe(false);
  });
  it("cannot say (null) when the route is missing or the answer is unreadable: the banner is then not drawn, nothing is guessed", async () => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getExampleStatus("tok", T)).toBeNull();
    apiRequest.mockResolvedValueOnce({ loaded: "yes" });
    expect(await getExampleStatus("tok", T)).toBeNull();
    apiRequest.mockResolvedValueOnce({ loaded: true, counts: { companies: -1 } });
    expect(await getExampleStatus("tok", T)).toBeNull();
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(getExampleStatus("tok", T)).rejects.toThrow(ApiAuthError);
  });
  it("loads with POST and removes with POST .../remove (the API has no DELETE), reporting what stayed", async () => {
    apiRequest.mockResolvedValueOnce(STATUS);
    expect(await loadExampleData("tok", T)).toBe("ok");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/example-data`, "tok", { method: "POST" });
    apiRequest.mockResolvedValueOnce({ batch_id: "b1", removed: { ...COUNTS, products: 3 }, kept: { ...NONE, products: 1 } });
    const out = await removeExampleData("tok", T);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/example-data/remove`, "tok", { method: "POST" });
    expect(out).toMatchObject({ result: "ok", removed: { removed: { products: 3 }, kept: { products: 1 } } });
  });
  it.each([[404, "x", "unavailable"], [501, "x", "unavailable"], [503, "packs_unavailable", "unavailable"], [403, "forbidden", "refused"], [409, "example_data_loaded", "refused"], [500, "x", "failed"], [503, "x", "failed"]])("a %i %s answer is '%s'", async (status, code, want) => {
    apiRequest.mockRejectedValue(new ApiRequestError(status, code, "x"));
    expect(await loadExampleData("tok", T)).toBe(want);
  });
  it("passes a rejected session on, and calls any other failure 'failed'", async () => {
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(loadExampleData("tok", T)).rejects.toThrow(ApiAuthError);
    apiRequest.mockRejectedValueOnce(new Error("boom"));
    expect((await removeExampleData("tok", T)).result).toBe("failed");
  });
});

describe("the business profile", () => {
  it("reads the name, the town and whether the setup is complete; an empty town is no town", () => {
    expect(parseProfile({ name: "Acme", town: "Guntur", languages: ["en"], setup_complete: true })).toEqual({ name: "Acme", town: "Guntur", languages: ["en"], setupComplete: true });
    expect(parseProfile({ name: "Acme", town: "  ", setup_complete: false })).toEqual({ name: "Acme", town: null, languages: [], setupComplete: false });
    expect(parseProfile({ name: "Acme", town: null })).toEqual({ name: "Acme", town: null, languages: [], setupComplete: false });
    expect(parseProfile({ name: "Acme", languages: ["te", "xx", 4, "ml"] }).languages).toEqual(["te", "ml"]); // only languages the API knows
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
