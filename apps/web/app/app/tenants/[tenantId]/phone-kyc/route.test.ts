import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/phone-kyc", async (orig) => ({ ...(await orig<typeof import("@/lib/api/phone-kyc")>()), submitKyc: (...a: unknown[]) => h.submit(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseKycStatus } from "@/lib/api/phone-kyc";
import { appT } from "@/i18n/app";

import { POST } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const K = "33333333-3333-4333-8333-333333333333";
const t = appT("en");
const BODY = { kyc_id: K, doc_kind: "gst", legal_name: "Demo Silks Pvt Ltd", registration_number: "36ABCDE1234F1Z5", email: "owner@example.test", address_line1: "1 Main Road", address_line2: "", city: "Hyderabad", state: "Telangana", postal_code: "500001", document: { name: "gst.pdf", content_type: "application/pdf", data_base64: "JVBERi0xLjQK" } };
const STATUS = parseKycStatus({ state: "submitted", kyc_id: K, doc_kind: "gst", compliance_id: "c-1", reason: null, created_at: null, updated_at: null, checked_at: null, live: true, can_choose_number: false });
const post = (body: unknown, opts: { id?: string; headers?: Record<string, string> } = {}) =>
  POST(new NextRequest(`http://x/app/tenants/${opts.id ?? T}/phone-kyc`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...opts.headers } }), { params: Promise.resolve({ tenantId: opts.id ?? T }) });

beforeEach(() => {
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.submit.mockReset().mockResolvedValue(STATUS);
});

describe("POST phone-kyc (the registration card; a route, not a server action, because of the 5 MB file)", () => {
  it("sends the body on with the person's token and answers where the registration stands (no JOBS, no flag)", async () => {
    const r = await post(BODY);
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ ok: true, data: { state: "submitted", kycId: K, live: true } });
    expect(h.submit).toHaveBeenCalledWith("tok", T, BODY);
  });
  it("tidies the number before it goes on (upper case, no spaces)", async () => {
    await post({ ...BODY, registration_number: "36abcde 1234f1z5" });
    expect(h.submit.mock.calls[0][2].registration_number).toBe("36ABCDE1234F1Z5");
  });
  it("is for the Owner only: an Admin or anyone else gets a refusal in words, and nothing is sent", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      h.tenant.mockResolvedValueOnce({ role });
      const r = await post(BODY);
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ ok: false, kind: "forbidden", error: t("phkyc.err.not_owner") });
    }
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("refuses a request from another site, a signed-out person and a bad workspace id before anything else", async () => {
    expect((await post(BODY, { headers: { "sec-fetch-site": "cross-site", origin: "http://evil.example" } })).status).toBe(403);
    h.user.mockRejectedValueOnce(new Error("signed out"));
    expect((await post(BODY)).status).toBe(401);
    expect((await post(BODY, { id: "not-a-uuid" })).status).toBe(404);
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("checks every field and the file first, in the person's language, and sends nothing when one is wrong", async () => {
    const bad = await post({ ...BODY, postal_code: "123" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ok: false, kind: "invalid", code: "field_postal", error: t("phkyc.err.field") });
    const big = await post({ ...BODY, document: { ...BODY.document, data_base64: "QUJD".repeat(1_666_667) } });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ ok: false, kind: "too_big", code: "kyc_file_too_large", error: t("phkyc.err.kyc_file_too_large") });
    const gif = await post({ ...BODY, document: { ...BODY.document, content_type: "image/gif" } });
    expect(await gif.json()).toMatchObject({ ok: false, code: "kyc_file_type", error: t("phkyc.err.kyc_file_type") });
    expect((await post({ ...BODY, document: { ...BODY.document, data_base64: "***" } })).status).toBe(422);
    expect((await post({ ...BODY, surprise: 1 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("refuses a request whose declared size is over the limit without reading it", async () => {
    const r = await post(BODY, { headers: { "content-length": "9000000" } });
    expect(r.status).toBe(413);
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("says each refusal of the API in our own words: 413, 415, 422 unreadable", async () => {
    for (const [status, code, kind] of [[413, "kyc_file_too_large", "too_big"], [415, "kyc_file_type", "invalid"], [422, "kyc_file_unreadable", "invalid"], [409, "kyc_document_not_offered", "conflict"], [409, "kyc_field_not_supported", "conflict"]] as const) {
      h.submit.mockRejectedValueOnce(new ApiRequestError(status, code, "English text of the API"));
      const out = await (await post(BODY)).json();
      expect(out).toMatchObject({ ok: false, kind, code, error: t(`phkyc.err.${code}`) });
      expect(JSON.stringify(out)).not.toContain("English text of the API");
    }
  });
  it("passes the phone company's own sentence on a refusal (422 kyc_not_accepted) as `reason`, bounded and without control characters", async () => {
    h.submit.mockRejectedValueOnce(new ApiRequestError(422, "kyc_not_accepted", "Plivo did not accept this filing. x", "The GSTIN is not active.\u0000\n" + "z".repeat(400)));
    const r = await post(BODY);
    expect(r.status).toBe(422);
    const out = await r.json();
    expect(out).toMatchObject({ ok: false, kind: "invalid", code: "kyc_not_accepted", error: t("phkyc.err.kyc_not_accepted") });
    expect(out.reason.startsWith("The GSTIN is not active.")).toBe(true);
    expect(out.reason.length).toBeLessThanOrEqual(300);
    expect(out.reason).not.toMatch(/[\u0000-\u001f]/);
  });
  it("says a phone company that did not answer (502) and registration being off (503) as 'try again', with a 503", async () => {
    h.submit.mockRejectedValueOnce(new ApiRequestError(502, "kyc_provider_unavailable", "x"));
    const a = await post(BODY);
    expect(a.status).toBe(503);
    expect(await a.json()).toMatchObject({ ok: false, kind: "unavailable", code: "kyc_provider_unavailable", error: t("phkyc.err.kyc_provider_unavailable") });
    h.submit.mockRejectedValueOnce(new ApiRequestError(503, "kyc_unavailable", "x"));
    expect(await (await post(BODY)).json()).toMatchObject({ code: "kyc_unavailable", error: t("phkyc.err.kyc_unavailable") });
  });
  it("a missing second step is the general sentence with the way to Security (mfa), a rejected session is a plain 401", async () => {
    h.submit.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await (await post(BODY)).json()).toMatchObject({ ok: false, kind: "mfa", mfa: true, error: t("apierr.mfa") });
    h.submit.mockRejectedValueOnce(new ApiAuthError("expired"));
    expect((await post(BODY)).status).toBe(401);
  });
  it("never logs the body, and an answer never carries the document back", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    h.submit.mockRejectedValueOnce(new ApiRequestError(502, "kyc_provider_unavailable", "x"));
    const out = await (await post(BODY)).text();
    const ok = await (await post(BODY)).text();
    expect(out).not.toContain(BODY.document.data_base64);
    expect(ok).not.toContain(BODY.document.data_base64);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(BODY.document.data_base64);
      s.mockRestore();
    }
  });
});
