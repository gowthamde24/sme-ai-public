import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./client";

const apiPublicRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiPublicRequest: (...a: unknown[]) => apiPublicRequest(...a) }));

import { postWaitlist, waitlistBody } from "./waitlist";

const value = { name: "Lakshmi", businessType: "education" as const, city: "Guntur", phone: "+919876543210", email: null, language: "ml" as const, marketingOptIn: false };
beforeEach(() => vi.clearAllMocks());

describe("the public waitlist call (contract-dpdp.md, section 1)", () => {
  it("sends the contract's fields with the notice version the visitor saw, marketing as given, and no captcha token yet", () => {
    expect(waitlistBody(value, "2026-10-25")).toEqual({ name: "Lakshmi", business_type: "education", city: "Guntur", phone: "+919876543210", email: null, language: "ml", marketing_opt_in: false, notice_version: "2026-10-25", captcha_token: null });
  });

  it("reads the notice, then posts without a sign-in; 'joined' and 'already_joined' are the same thank-you", async () => {
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "2026-10-25" }).mockResolvedValueOnce({ status: "joined", marketing_opt_in: false });
    expect(await postWaitlist(value)).toEqual({ ok: true });
    expect(apiPublicRequest).toHaveBeenNthCalledWith(1, "/v1/privacy/notice");
    expect(apiPublicRequest).toHaveBeenNthCalledWith(2, "/v1/public/waitlist", { method: "POST", body: expect.objectContaining({ notice_version: "2026-10-25", marketing_opt_in: false }) });
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "2026-10-25" }).mockResolvedValueOnce({ status: "already_joined" });
    expect(await postWaitlist(value)).toEqual({ ok: true });
  });

  it("a rate limit is 'rate'; a refusal of the form is 'invalid'; anything else (API down, a strange answer) is 'down', never a success", async () => {
    apiPublicRequest.mockResolvedValue({ privacy_version: "v1" });
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "v1" }).mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 60));
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "rate" });
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "v1" }).mockRejectedValueOnce(new ApiRequestError(422, "invalid", "x"));
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "invalid" });
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "v1" }).mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "down" });
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "v1" }).mockResolvedValueOnce({ status: "weird" });
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "down" });
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(500, "http_error", "x"));
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "down" }); // the notice itself could not be read
    apiPublicRequest.mockResolvedValueOnce({ privacy_version: "../../etc" });
    expect(await postWaitlist(value)).toEqual({ ok: false, error: "down" }); // a notice version that is not a version is not passed on
  });
});
