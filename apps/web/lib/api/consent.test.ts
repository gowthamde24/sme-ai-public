import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { BASES, BASIS_LABELS, CHANNELS, EVIDENCE_KINDS, EVIDENCE_LABEL_PATTERN, EVIDENCE_LABELS, parseConsents, recordConsent, STATUS_LABELS } from "./consent";

const T = "22222222-2222-2222-2222-222222222222";
const C = "44444444-4444-4444-4444-444444444444";
const ANSWER = { event_id: "55555555-5555-4555-8555-555555555555", contact: { whatsapp_consent: "granted", phone_consent: "unknown", email_consent: "withdrawn", phone: "+00 90000 20001", email: "a@b.example.test" } };

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

describe("recordConsent", () => {
  it("sends a granted entry with its basis and a reference built from the kind and the label", async () => {
    apiRequest.mockResolvedValue(ANSWER);
    const r = await recordConsent("tok", T, C, { channel: "whatsapp", status: "granted", basis: "explicit_consent", evidenceKind: "verbal", evidenceLabel: "call-2026-10-08" });
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${T}/contacts/${C}/record-consent`);
    expect(token).toBe("tok");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ channel: "whatsapp", status: "granted", basis: "explicit_consent", evidence_type: "verbal", evidence_ref: "verbal:call-2026-10-08" });
    expect(r).toEqual({ whatsapp: "granted", phone: "unknown", email: "withdrawn" });
  });
  it("sends a withdrawn entry with nothing else", async () => {
    apiRequest.mockResolvedValue(ANSWER);
    await recordConsent("tok", T, C, { channel: "phone", status: "withdrawn" });
    expect(JSON.parse(String((apiRequest.mock.calls[0] as [string, string, RequestInit])[2].body))).toEqual({ channel: "phone", status: "withdrawn" });
  });
  it("returns the three states only, never the number or the address the API sent", async () => {
    apiRequest.mockResolvedValue(ANSWER);
    const text = JSON.stringify(await recordConsent("tok", T, C, { channel: "email", status: "withdrawn" }));
    expect(text).not.toMatch(/90000|@/);
  });
  it("refuses malformed ids before any request", async () => {
    await expect(recordConsent("tok", "x", C, { channel: "phone", status: "withdrawn" })).rejects.toThrow(ApiContractError);
    await expect(recordConsent("tok", T, "../x", { channel: "phone", status: "withdrawn" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("parseConsents is strict", () => {
  it.each([[null], [[]], [{}], [{ contact: null }], [{ contact: { whatsapp_consent: "yes", phone_consent: "unknown", email_consent: "unknown" } }], [{ contact: { whatsapp_consent: "granted", phone_consent: "unknown" } }]])("refuses %j", (body) => {
    expect(() => parseConsents(body)).toThrow(ApiContractError);
  });
});

describe("the words", () => {
  it("every choice has a plain label, and none claims a verdict", () => {
    for (const c of CHANNELS) expect(c).toBeTruthy();
    const all = [...BASES.map((b) => BASIS_LABELS[b]), ...EVIDENCE_KINDS.map((k) => EVIDENCE_LABELS[k]), ...Object.values(STATUS_LABELS)].join(" ");
    expect(all).not.toMatch(/valid|lawful|legal(?!\w)|complian|approved|verified/i);
  });
  it("the label pattern matches the API's reference character set and refuses spaces, @ and long text", () => {
    expect(EVIDENCE_LABEL_PATTERN.test("call-2026-10-08")).toBe(true);
    for (const bad of ["a b", "a@b", "", "x".repeat(97), "ఆ"]) expect(EVIDENCE_LABEL_PATTERN.test(bad)).toBe(false);
  });
});
