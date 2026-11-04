import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getOfferedSources } from "./lead-sources";

const T = "22222222-2222-4222-8222-222222222222";
const KNOWN = ["indiamart", "99acres", "website_form", "meta_lead_ads", "excel_upload", "google_sheet"] as const;
beforeEach(() => vi.clearAllMocks());

describe("the sources a business is offered (GET lead-sources/offered, #287)", () => {
  it("a school gets its own few, in the API's order; a tag this web cannot name is dropped", async () => {
    apiRequest.mockResolvedValueOnce({ tags: ["website_form", "meta_lead_ads", "excel_upload", "google_sheet", "vcard_new"], school: true });
    expect(await getOfferedSources("tok", T, KNOWN)).toEqual(["website_form", "meta_lead_ads", "excel_upload", "google_sheet"]);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/lead-sources/offered`, "tok");
  });
  it("cannot tell (an older API, a bad body): null, so the screen offers its own full list; a rejected session is thrown", async () => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getOfferedSources("tok", T, KNOWN)).toBeNull();
    apiRequest.mockResolvedValueOnce({ tags: "indiamart" });
    expect(await getOfferedSources("tok", T, KNOWN)).toBeNull();
    apiRequest.mockRejectedValueOnce(new ApiAuthError("no"));
    await expect(getOfferedSources("tok", T, KNOWN)).rejects.toThrow(ApiAuthError);
  });
});
