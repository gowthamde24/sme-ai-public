import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";

const apiRequest = vi.fn();
const apiPublicRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiPublicRequest: (...a: unknown[]) => apiPublicRequest(...a) }));

import { forgetSubprocessors, getMyConsents, getPrivacyNotice, parseConsents, parseNotice, parseSubprocessors, postGrievance, putMarketingConsent, subprocessorsCached } from "./dpdp";

/** The shapes of contract-dpdp.md, as C1 published them. */
const NOTICE = { privacy_version: "2026-10-27", terms_version: "2026-10-27", contact: { privacy_email: "privacy@stack19.com", hello_email: "hello@stack19.com" }, grievance: { acknowledged: "at once", answer_within_days: 30 }, retention: { lapsed_read_only_days: 90, erasure_warning_hours: 48, account_deletion_cancel_days: 7, security_log_days: 365 }, purposes: [{ purpose: "service", required: true }, { purpose: "marketing", required: false, default: "off" }] };
const SUBS = { version: "2026-10-27", updated_on: "2026-10-27", wording: "draft", subprocessors: [{ id: "google_cloud", name: "Google Cloud", purpose: "Hosting of the app, its worker and files", country: "India (Mumbai)", data: "All app data", link: "https://cloud.google.com/terms/data-processing-addendum" }, { id: "resend", name: "Resend", purpose: "Sending e-mail", country: "United States", data: "E-mail addresses and the text of our own e-mails", link: null }] };
const CONSENTS = { notice_version: "2026-10-27", consents: [{ purpose: "service", state: "given", since: "2026-10-01T05:00:00Z", notice_version: "2026-10-27", via: "signup" }, { purpose: "marketing", state: "withdrawn", since: "2026-10-20T05:00:00Z", notice_version: "2026-10-27", via: "settings" }], history: [{ purpose: "marketing", action: "withdrawn", at: "2026-10-20T05:00:00Z", notice_version: "2026-10-27", via: "settings" }, { purpose: "marketing", action: "given", at: "2026-10-01T05:00:00Z", notice_version: "2026-10-27", via: "signup" }] };
beforeEach(() => {
  vi.clearAllMocks();
  forgetSubprocessors();
});

describe("the notice facts (contract-dpdp.md, section 1)", () => {
  it("reads the version, the addresses, the answer time and the retention numbers", async () => {
    apiPublicRequest.mockResolvedValue(NOTICE);
    expect(await getPrivacyNotice()).toEqual({ privacyVersion: "2026-10-27", termsVersion: "2026-10-27", privacyEmail: "privacy@stack19.com", helloEmail: "hello@stack19.com", grievance: { answerWithinDays: 30 }, retention: { lapsedReadOnlyDays: 90, erasureWarningHours: 48, accountDeletionCancelDays: 7, securityLogDays: 365 } });
    expect(apiPublicRequest).toHaveBeenCalledWith("/v1/privacy/notice");
  });
  it("refuses an answer that is not that shape (a version with a slash, an address with no @, a missing number)", () => {
    expect(() => parseNotice({ ...NOTICE, privacy_version: "../x" })).toThrow(ApiContractError);
    expect(() => parseNotice({ ...NOTICE, contact: { privacy_email: "nope", hello_email: "h@x.test" } })).toThrow(ApiContractError);
    expect(() => parseNotice({ ...NOTICE, retention: { lapsed_read_only_days: 90 } })).toThrow(ApiContractError);
  });
  it("the retention numbers the web states are the ones the API publishes (lib/site/business.ts RETENTION)", async () => {
    const { RETENTION, RESPONSE_DAYS } = await import("@/lib/site/business");
    const n = parseNotice(NOTICE);
    expect(n.retention).toEqual({ lapsedReadOnlyDays: RETENTION.lapsedReadOnlyDays, erasureWarningHours: RETENTION.erasureWarningHours, accountDeletionCancelDays: RETENTION.deletionCancelDays, securityLogDays: RETENTION.securityLogDays });
    expect(n.grievance.answerWithinDays).toBe(RESPONSE_DAYS.grievances);
  });
});

describe("the companies that process data", () => {
  it("reads each company with its country and purpose; only an https link is kept; the wording flag says draft", () => {
    const s = parseSubprocessors(SUBS);
    expect(s.items.map((p) => [p.id, p.name, p.country, p.link])).toEqual([["google_cloud", "Google Cloud", "India (Mumbai)", "https://cloud.google.com/terms/data-processing-addendum"], ["resend", "Resend", "United States", null]]);
    expect(s.draft).toBe(true);
    expect(parseSubprocessors({ ...SUBS, subprocessors: [{ ...SUBS.subprocessors[0], link: "javascript:alert(1)" }] }).items[0].link).toBeNull();
    expect(() => parseSubprocessors({ ...SUBS, subprocessors: [{ id: "bad id", name: "x", purpose: "p", country: "c", data: "d" }] })).toThrow(ApiContractError);
  });
  it("the list is read once in five minutes, and a failed read is not kept", async () => {
    apiPublicRequest.mockResolvedValue(SUBS);
    await subprocessorsCached(1_000);
    await subprocessorsCached(100_000);
    expect(apiPublicRequest).toHaveBeenCalledTimes(1);
    await subprocessorsCached(1_000 + 6 * 60_000);
    expect(apiPublicRequest).toHaveBeenCalledTimes(2);
    forgetSubprocessors();
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    await expect(subprocessorsCached(9)).rejects.toThrow();
    apiPublicRequest.mockResolvedValue(SUBS);
    expect((await subprocessorsCached(10)).items).toHaveLength(2);
  });
});

describe("the person's consents", () => {
  it("reads the marketing state with its history (newest first) and ignores the service line, which cannot be switched here", async () => {
    apiRequest.mockResolvedValue(CONSENTS);
    const c = await getMyConsents("tok");
    expect(c.marketing).toEqual({ state: "withdrawn", since: "2026-10-20T05:00:00Z" });
    expect(c.history.map((h) => h.action)).toEqual(["withdrawn", "given"]);
    expect(apiRequest).toHaveBeenCalledWith("/v1/me/consents", "tok");
    expect(() => parseConsents({ ...CONSENTS, consents: [CONSENTS.consents[0]] })).toThrow(ApiContractError);
  });
  it("giving and withdrawing are the SAME one call: PUT with {given, via}", async () => {
    apiRequest.mockResolvedValue(CONSENTS);
    await putMarketingConsent("tok", true, "signup");
    await putMarketingConsent("tok", false);
    expect(apiRequest).toHaveBeenNthCalledWith(1, "/v1/me/consents/marketing", "tok", { method: "PUT", body: JSON.stringify({ given: true, via: "signup" }) });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/v1/me/consents/marketing", "tok", { method: "PUT", body: JSON.stringify({ given: false, via: "settings" }) });
    await expect(putMarketingConsent("tok", true, "facebook" as never)).rejects.toThrow(ApiContractError);
  });
});

describe("raising a grievance (public, no sign-in)", () => {
  const input = { name: "Lakshmi", contact: "lakshmi@shop.example", kind: "erasure" as const, details: "Please erase my number.", language: "te" as const };
  it("posts the contract's fields with a grievance id and reads the reference and the day the answer is due", async () => {
    apiPublicRequest.mockResolvedValue({ reference: "GR-2026-000123", status: "received", received_at: "2026-10-27T05:00:00Z", answer_due_on: "2026-11-26", answer_within_days: 30 });
    expect(await postGrievance(input, "6f1d1f5e-1c8b-4f5a-9c2e-0a1b2c3d4e5f")).toEqual({ ok: true, reference: "GR-2026-000123", answerDueOn: "2026-11-26", answerWithinDays: 30 });
    expect(apiPublicRequest).toHaveBeenCalledWith("/v1/privacy/grievance", { method: "POST", body: { grievance_id: "6f1d1f5e-1c8b-4f5a-9c2e-0a1b2c3d4e5f", name: "Lakshmi", contact: "lakshmi@shop.example", kind: "erasure", details: "Please erase my number.", language: "te", captcha_token: null } });
  });
  it("a rate limit is 'rate', a refusal of the form 'invalid', anything else 'down'; a reference that is not one is never shown as a receipt", async () => {
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30));
    expect(await postGrievance(input, "id")).toEqual({ ok: false, error: "rate" });
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(422, "invalid", "x"));
    expect(await postGrievance(input, "id")).toEqual({ ok: false, error: "invalid" });
    apiPublicRequest.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await postGrievance(input, "id")).toEqual({ ok: false, error: "down" });
    apiPublicRequest.mockResolvedValueOnce({ reference: "<script>", answer_due_on: "2026-11-26", answer_within_days: 30 });
    expect(await postGrievance(input, "id")).toEqual({ ok: false, error: "down" });
    expect(await postGrievance({ ...input, kind: "hack" as never }, "id")).toEqual({ ok: false, error: "invalid" });
  });
});
