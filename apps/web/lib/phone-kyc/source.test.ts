import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ value: null as unknown, mode: "mock" as "mock" | "off" | "1" }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (_n: string, parse: (v: unknown) => unknown, fallback: unknown) => (jar.value === null ? fallback : (parse(jar.value) ?? fallback)),
  writeJar: async (_n: string, v: unknown) => ((jar.value = JSON.parse(JSON.stringify(v))), true),
  clearJar: async () => void (jar.value = null),
}));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), kycPerClient: () => jar.mode }));

import { ApiRequestError } from "@/lib/api/client";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { checkGst, checkPan, readStatus, refused, saveDetails, sendDocument, startAadhaar, startAccount, submitAll } from "./source";

const details = { accountType: "individual", fullName: "Asha Rao", phone: "+91 98765 43210", billingAddress: "12 Main Road, Anantapur", city: "Anantapur", state: "Andhra Pradesh", pincode: "515001", acceptTerms: true };
const bytes = new Uint8Array([1, 2, 3]);
beforeEach(() => {
  jar.value = null;
  jar.mode = "mock";
});

describe("Verify your business in the test screen (KYC_PER_CLIENT=mock): nothing is sent, the steps keep their order", () => {
  it("is off when the flag is off: no status, every move is refused as invalid", async () => {
    jar.mode = "off";
    expect(await readStatus("t", "x")).toBeNull();
    expect(await startAccount("t", "x", "individual")).toEqual({ ok: false, error: "invalid" });
  });
  it("starts at not_started, then created, then in_progress after the details", async () => {
    expect((await readStatus("t", "x"))?.state).toBe("not_started");
    expect(await startAccount("t", "x", "business")).toMatchObject({ ok: true, data: { state: "created", accountType: "business" } });
    expect(await saveDetails("t", "x", { ...details, accountType: "business", businessName: "Asha Silks" })).toMatchObject({ ok: true, data: { state: "in_progress" } });
  });
  it("the details are checked again here: a short name, a bad phone, a bad PIN, terms not ticked, a business without its name", async () => {
    await startAccount("t", "x", "individual");
    for (const bad of [{ fullName: "A" }, { phone: "abc" }, { phone: "5876543210" }, { pincode: "12" }, { pincode: "015001" }, { acceptTerms: false }, { billingAddress: "short" }, { city: "" }, { state: "" }, { state: "Atlantis" }]) expect(await saveDetails("t", "x", { ...details, ...bad })).toEqual({ ok: false, error: "invalid" });
    expect(await saveDetails("t", "x", { ...details, accountType: "business" })).toEqual({ ok: false, error: "invalid" });
  });
  it("a phone typed with +91, 91 or a leading 0 is accepted and goes as +91 and ten digits; the state must be one of the list", async () => {
    await startAccount("t", "x", "individual");
    for (const phone of ["98765 43210", "+91 98765-43210", "091 98765 43210", "919876543210"]) expect(await saveDetails("t", "x", { ...details, phone })).toMatchObject({ ok: true });
    // (live) the number goes on as ten digits, never with a "+": the phone service refuses it
    jar.mode = "1";
    request.mockResolvedValue({ state: "in_progress", account_type: "individual", steps: {} });
    await saveDetails("t", "55555555-5555-4555-8555-555555555555", { ...details, phone: "+91 98765-43210" });
    expect(JSON.parse((request.mock.calls.at(-1) as unknown as [string, string, { body: string }])[2].body).phone).toBe("9876543210");
  });
  it("a 422 kyc_fields_invalid keeps each field with its closed word (never the value)", () => {
    const e = new ApiRequestError(422, "kyc_fields_invalid", "x", undefined, undefined, undefined, { fields: ["phone", "pincode"], reasons: { phone: "mobile_invalid", pincode: "pincode_invalid" } });
    expect(refused(e)).toEqual({ ok: false, error: "invalid", fieldReasons: { phone: "mobile_invalid", pincode: "pincode_invalid" } });
  });
  it("details before the account is started: step_order in words, not a crash", async () => {
    expect(await saveDetails("t", "x", details)).toEqual({ ok: false, error: "refused", reason: "not_started" });
  });
  it("PAN: ten characters of the right shape; a name that does not match is pan_mismatch in the test screen", async () => {
    await startAccount("t", "x", "individual");
    await saveDetails("t", "x", details);
    expect(await checkPan("t", "x", "ABC", "Asha Rao")).toEqual({ ok: false, error: "invalid" });
    expect(await checkPan("t", "x", "ABCDE1234F", "A")).toEqual({ ok: false, error: "invalid" });
    expect(await checkPan("t", "x", "ABCDE1234F", "mismatch")).toEqual({ ok: false, error: "refused", reason: "pan_mismatch" });
    expect(await checkPan("t", "x", "ABCDE1234F", "Asha Rao")).toMatchObject({ ok: true });
  });
  it("a document goes only after its number or link, is size and type checked, and marks its step", async () => {
    await startAccount("t", "x", "individual");
    await saveDetails("t", "x", details);
    expect(await sendDocument("t", "x", "pan", "image/png", bytes)).toEqual({ ok: false, error: "refused", reason: "step_order" });
    await checkPan("t", "x", "ABCDE1234F", "Asha Rao");
    expect(await sendDocument("t", "x", "pan", "image/gif", bytes)).toEqual({ ok: false, error: "invalid" });
    expect(await sendDocument("t", "x", "pan", "image/png", new Uint8Array())).toEqual({ ok: false, error: "refused", reason: "file_unreadable" });
    expect(await sendDocument("t", "x", "pan", "image/png", { length: 11 * 1024 * 1024 } as Uint8Array)).toEqual({ ok: false, error: "refused", reason: "file_too_big" });
    expect(await sendDocument("t", "x", "pan", "application/pdf", bytes)).toMatchObject({ ok: true, data: { steps: { pan: true, aadhaar: false } } });
  });
  it("Aadhaar gives an https DigiLocker address (opened on the person's own phone) and never a document of ours", async () => {
    await startAccount("t", "x", "individual");
    await saveDetails("t", "x", details);
    const r = await startAadhaar("t", "x");
    expect(r.ok && r.data.url).toMatch(/^https:\/\//);
  });
  it("GST is for a business only", async () => {
    await startAccount("t", "x", "individual");
    await saveDetails("t", "x", details);
    expect(await checkGst("t", "x", "29ABCDE1234F1Z5")).toEqual({ ok: false, error: "refused", reason: "step_order" });
    expect(await checkGst("t", "x", "12")).toEqual({ ok: false, error: "invalid" });
  });
  it("submit with a document missing names it; with all there it is submitted, and the check finishes later", async () => {
    await startAccount("t", "x", "individual");
    await saveDetails("t", "x", details);
    await checkPan("t", "x", "ABCDE1234F", "Asha Rao");
    await sendDocument("t", "x", "pan", "image/png", bytes);
    expect(await submitAll("t", "x")).toEqual({ ok: false, error: "refused", reason: "missing_documents", missing: ["Aadhaar"] });
    await startAadhaar("t", "x");
    await sendDocument("t", "x", "aadhaar", "image/png", bytes);
    expect(await submitAll("t", "x")).toMatchObject({ ok: true, data: { state: "submitted" } });
    const kept = jar.value as { at: number };
    jar.value = { ...kept, at: Date.now() - 61_000 };
    expect((await readStatus("t", "x"))?.state).toBe("verified");
  });
});

describe("a refusal of the API in closed words", () => {
  it("403 mfa_required is the second step; another 403 is forbidden", () => {
    expect(refused(new ApiRequestError(403, "mfa_required", "x"))).toEqual({ ok: false, error: "step_up" });
    expect(refused(new ApiRequestError(403, "forbidden", "x"))).toEqual({ ok: false, error: "forbidden" });
  });
  it("kyc_refused with a reason keeps the reason; a word outside the list reads as refused; 503 reads as down", () => {
    expect(refused(new ApiRequestError(422, "kyc_refused", "x", "pan_mismatch"))).toEqual({ ok: false, error: "refused", reason: "pan_mismatch" });
    expect(refused(new ApiRequestError(422, "kyc_refused", "x", "something_new"))).toEqual({ ok: false, error: "refused", reason: "refused" });
    expect(refused(new ApiRequestError(503, "kyc_unavailable", "x"))).toEqual({ ok: false, error: "down", reason: "unavailable" });
    expect(refused(new Error("boom"))).toEqual({ ok: false, error: "down" });
  });
});
