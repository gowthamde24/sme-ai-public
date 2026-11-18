import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("./client", () => ({ apiRequest: (...a: unknown[]) => api(...a) }));

import { markEnquiryDone } from "./enquiry";

const T = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";

beforeEach(() => api.mockReset());

describe("Done on Enquired again", () => {
  it("posts to the lead's enquiry-done with no body", async () => {
    api.mockResolvedValue({ handled: 1 });
    await markEnquiryDone("tok", T, L);
    expect(api).toHaveBeenCalledWith(`/v1/tenants/${T}/leads/${L}/enquiry-done`, "tok", { method: "POST" });
  });
  it("refuses an id that is not a uuid before asking", async () => {
    await expect(markEnquiryDone("tok", T, "x")).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
});
