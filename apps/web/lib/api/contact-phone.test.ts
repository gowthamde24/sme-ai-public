import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { fetchContactPhone } from "./contact-phone";

const T = "22222222-2222-2222-2222-222222222222";
const C = "44444444-4444-4444-4444-444444444444";
const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
afterEach(() => vi.clearAllMocks());

describe("fetchContactPhone", () => {
  it("reads the contact on its own path with the token and returns the phone only", async () => {
    apiRequest.mockResolvedValue({ id: C, full_name: "Synthetic Person", email: "x@example.test", phone: "+00 90000 20001" });
    expect(await fetchContactPhone("tok", T, C)).toBe("+00 90000 20001");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/contacts/${C}`, "tok");
  });
  it("a contact with no phone gives null", async () => {
    apiRequest.mockResolvedValue({ id: C, phone: null });
    expect(await fetchContactPhone("tok", T, C)).toBeNull();
  });
  it.each([[null], [[]], [{}], [{ phone: 5 }], [{ phone: ["x"] }]])("a body that is not a contact with a phone field (%j) is an error with a fixed message", async (body) => {
    apiRequest.mockResolvedValue(body);
    await expect(fetchContactPhone("tok", T, C)).rejects.toThrow(ApiContractError);
  });
  it("the error message never contains the value", async () => {
    apiRequest.mockResolvedValue({ phone: 987654 });
    await expect(fetchContactPhone("tok", T, C)).rejects.toThrow("Unexpected contact in a response.");
  });
  it.each([["x", C], [T, "x"]])("malformed ids (%s, %s) are refused before any request", async (t, c) => {
    await expect(fetchContactPhone("tok", t, c)).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
