import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { fetchLeadContactId } from "./lead-contact";

const T = "22222222-2222-2222-2222-222222222222";
const L = "33333333-3333-3333-3333-333333333333";
const C = "44444444-4444-4444-4444-444444444444";
const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
afterEach(() => vi.clearAllMocks());

describe("fetchLeadContactId", () => {
  it("reads the lead on its own path with the token and returns the contact id only", async () => {
    apiRequest.mockResolvedValue({ id: L, contact_id: C, source: "x", phone: "+00 90000 20001" });
    expect(await fetchLeadContactId("tok", T, L)).toBe(C);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/leads/${L}`, "tok");
  });
  it("a lead with no contact gives null", async () => {
    apiRequest.mockResolvedValue({ id: L, contact_id: null });
    expect(await fetchLeadContactId("tok", T, L)).toBeNull();
  });
  it.each([[null], [[]], [{}], [{ contact_id: 5 }], [{ contact_id: "x" }]])("a body that is not a lead with a contact id (%j) is an error", async (body) => {
    apiRequest.mockResolvedValue(body);
    await expect(fetchLeadContactId("tok", T, L)).rejects.toThrow(ApiContractError);
  });
  it("refuses malformed ids before any request", async () => {
    await expect(fetchLeadContactId("tok", "x", L)).rejects.toThrow(ApiContractError);
    await expect(fetchLeadContactId("tok", T, "../x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
