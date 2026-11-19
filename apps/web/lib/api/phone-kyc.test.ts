import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KycBody } from "@/lib/phone-kyc/types";
import { KYC_STATES } from "@/lib/phone-kyc/types";

import { ApiContractError } from "./client";

const h = vi.hoisted(() => ({ req: vi.fn() }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));

import { getKycOptions, getKycStatus, parseKycOptions, parseKycStatus, submitKyc } from "./phone-kyc";

const T = "22222222-2222-4222-8222-222222222222";
const K = "33333333-3333-4333-8333-333333333333";
const STATUS = { state: "submitted", kyc_id: K, doc_kind: "gst", compliance_id: "abc-123", reason: null, created_at: "2026-11-19T05:00:00Z", updated_at: "2026-11-19T05:01:00+00:00", checked_at: null, live: true, can_choose_number: false };
const OPTIONS = {
  live: false,
  documents: [
    { kind: "gst", number_label: "GSTIN", number_example: "36ABCDE1234F1Z5", plivo_document: "GST" },
    { kind: "udyam", number_label: "Udyam registration number", number_example: "UDYAM-TS-02-0000001", plivo_document: "Udyam" },
    { kind: "coi", number_label: "CIN / LLPIN", number_example: "U12345TG2020PTC123456", plivo_document: "Certificate of Incorporation" },
  ],
  max_file_bytes: 5_000_000,
  file_types: ["application/pdf", "image/jpeg", "image/png"],
  kept_note: "The document is sent to Plivo and not kept by Stack19.",
};
beforeEach(() => h.req.mockReset());

describe("the registration status", () => {
  it("reads every state the API has, and nothing else", () => {
    for (const state of KYC_STATES) expect(parseKycStatus({ ...STATUS, state }).state).toBe(state);
    expect(() => parseKycStatus({ ...STATUS, state: "approved" })).toThrow(ApiContractError);
  });
  it("reads a bare 'not started' answer (every other field empty) and maps the words to ours", () => {
    expect(parseKycStatus({ state: "not_started", kyc_id: null, doc_kind: null, compliance_id: null, reason: null, created_at: null, updated_at: null, checked_at: null, live: false, can_choose_number: false })).toEqual({
      state: "not_started", kycId: null, docKind: null, complianceId: null, reason: null, createdAt: null, updatedAt: null, checkedAt: null, live: false, canChooseNumber: false,
    });
    expect(parseKycStatus(STATUS)).toMatchObject({ state: "submitted", kycId: K, docKind: "gst", complianceId: "abc-123", live: true, canChooseNumber: false });
  });
  it("keeps the phone company's own words for a rejection, trimmed; blank is none", () => {
    expect(parseKycStatus({ ...STATUS, state: "rejected", reason: "  The GSTIN is not active.  " }).reason).toBe("The GSTIN is not active.");
    expect(parseKycStatus({ ...STATUS, state: "rejected", reason: "   " }).reason).toBeNull();
  });
  it("refuses a document kind we do not know, a flag that is not a boolean and an id that is not an id", () => {
    expect(() => parseKycStatus({ ...STATUS, doc_kind: "passport" })).toThrow(ApiContractError);
    expect(() => parseKycStatus({ ...STATUS, live: "yes" })).toThrow(ApiContractError);
    expect(() => parseKycStatus({ ...STATUS, kyc_id: "nope" })).toThrow(ApiContractError);
    expect(() => parseKycStatus({ ...STATUS, compliance_id: "a b" })).toThrow(ApiContractError);
    expect(() => parseKycStatus(null)).toThrow(ApiContractError);
  });
});

describe("the documents on offer", () => {
  it("reads the three documents with their number labels, and the file rules", () => {
    const o = parseKycOptions(OPTIONS);
    expect(o.documents.map((d) => [d.kind, d.numberLabel, d.numberExample])).toEqual([
      ["gst", "GSTIN", "36ABCDE1234F1Z5"],
      ["udyam", "Udyam registration number", "UDYAM-TS-02-0000001"],
      ["coi", "CIN / LLPIN", "U12345TG2020PTC123456"],
    ]);
    expect(o).toMatchObject({ live: false, maxFileBytes: 5_000_000, fileTypes: ["application/pdf", "image/jpeg", "image/png"] });
  });
  it("refuses no documents, an unknown kind or file type, and a size that is not a size", () => {
    expect(() => parseKycOptions({ ...OPTIONS, documents: [] })).toThrow(ApiContractError);
    expect(() => parseKycOptions({ ...OPTIONS, documents: [{ ...OPTIONS.documents[0], kind: "pan" }] })).toThrow(ApiContractError);
    expect(() => parseKycOptions({ ...OPTIONS, file_types: ["image/gif"] })).toThrow(ApiContractError);
    expect(() => parseKycOptions({ ...OPTIONS, max_file_bytes: "5mb" })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("reads the status and the options with the person's own token, only for a real workspace id", async () => {
    h.req.mockResolvedValueOnce(STATUS).mockResolvedValueOnce(OPTIONS);
    expect((await getKycStatus("tok", T)).state).toBe("submitted");
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/phone-kyc`, "tok");
    expect((await getKycOptions("tok", T)).documents).toHaveLength(3);
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/phone-kyc/options`, "tok");
    await expect(getKycStatus("tok", "not-a-uuid")).rejects.toThrow(ApiContractError);
  });
  it("files the application: POST with the body as it is, and the answer is where it stands now", async () => {
    h.req.mockResolvedValueOnce({ ...STATUS, state: "not_started", live: false });
    const body: KycBody = { kyc_id: K, doc_kind: "gst", legal_name: "Demo Silks Pvt Ltd", registration_number: "36ABCDE1234F1Z5", email: "a@example.test", address_line1: "1 Main Road", address_line2: "", city: "Hyderabad", state: "Telangana", postal_code: "500001", document: { name: "gst.pdf", content_type: "application/pdf", data_base64: "JVBERi0x" } };
    const out = await submitKyc("tok", T, body);
    expect(out).toMatchObject({ state: "not_started", live: false });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/phone-kyc`, "tok", { method: "POST", body: JSON.stringify(body) });
  });
});
