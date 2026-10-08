import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { createCustomerCompany: vi.fn(), createContact: vi.fn(), createLead: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/customers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/customers")>()),
  createCustomerCompany: (...a: unknown[]) => api.createCustomerCompany(...a),
  createContact: (...a: unknown[]) => api.createContact(...a),
  createLead: (...a: unknown[]) => api.createLead(...a),
}));

import { addCustomerAction } from "./actions";

const T = "22222222-2222-2222-2222-222222222222";
const CO = "33333333-3333-3333-3333-333333333333";
const CT = "44444444-4444-4444-4444-444444444444";
const LD = "55555555-5555-4555-8555-555555555555";
const CANARY = "CANARY-c1a77e";
const PHONE = "+00 90000 20001";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = { company_id: CO, contact_id: CT, lead_id: LD, full_name: "Synthetic Asha", phone: PHONE, email: "", company_name: "", how: "whatsapp" };
  for (const [k, v] of Object.entries({ ...base, ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => addCustomerAction(T, undefined, form(over));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.createCustomerCompany.mockResolvedValue(undefined);
  api.createContact.mockResolvedValue(CT);
  api.createLead.mockResolvedValue(LD);
});

describe("addCustomerAction", () => {
  it("authenticates first, then makes the company, the contact and the lead in that order with the page's ids", async () => {
    const order: string[] = [];
    api.createCustomerCompany.mockImplementation(async () => void order.push("company"));
    api.createContact.mockImplementation(async () => (order.push("contact"), CT));
    api.createLead.mockImplementation(async () => (order.push("lead"), LD));
    const r = await run();
    expect(order).toEqual(["company", "contact", "lead"]);
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.createCustomerCompany).toHaveBeenCalledWith("tok", T, { id: CO, name: "Synthetic Asha" });
    expect(api.createContact).toHaveBeenCalledWith("tok", T, { id: CT, companyId: CO, fullName: "Synthetic Asha", phone: PHONE, email: null });
    expect(api.createLead).toHaveBeenCalledWith("tok", T, { id: LD, companyId: CO, contactId: CT, source: "whatsapp" });
    expect(r).toEqual({ ok: true, leadId: LD, contactId: CT, name: "Synthetic Asha" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("a phone-only customer works: no e-mail is sent", async () => {
    await run({ email: "" });
    expect(api.createContact.mock.calls[0][2].email).toBeNull();
  });
  it("sends the e-mail when given, and the shop name as the company's name", async () => {
    await run({ email: "a@b.example.test", company_name: "Asha Silks" });
    expect(api.createContact.mock.calls[0][2].email).toBe("a@b.example.test");
    expect(api.createCustomerCompany.mock.calls[0][2].name).toBe("Asha Silks");
  });
  it("the answer never carries the phone number or the e-mail back", async () => {
    const text = JSON.stringify(await run({ email: "a@b.example.test" }));
    expect(text).not.toContain("90000");
    expect(text).not.toContain("a@b");
  });
  it("a Telugu name is accepted as it is", async () => {
    expect((await run({ full_name: "సరస్వతి" }))?.ok).toBe(true);
    expect(api.createContact.mock.calls[0][2].fullName).toBe("సరస్వతి");
  });
  it.each([
    [{ full_name: "  " }, /customer's name/],
    [{ full_name: "x".repeat(201) }, /customer's name/],
    [{ company_name: "x".repeat(201) }, /shop name is too long/],
    [{ phone: "12" }, /number/],
    [{ phone: "1".repeat(33) }, /number/],
    [{ email: "x".repeat(255) }, /e-mail is too long/],
    [{ how: "carrier_pigeon" }, /how the enquiry came/],
    [{ lead_id: "x" }, /out of date/],
    [{ company_id: "" }, /out of date/],
  ])("refuses %j before the API is called", async (over, message) => {
    const r = await run(over);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(message);
    expect(api.createCustomerCompany).not.toHaveBeenCalled();
  });
  it("a malformed workspace id never reaches the API", async () => {
    expect((await addCustomerAction("x", undefined, form()))?.error).toBe("This workspace is not available.");
    expect(api.createCustomerCompany).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    api.createCustomerCompany.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
  it.each([
    [new ApiRequestError(403, "forbidden", CANARY), /Your role cannot add customers/],
    [new ApiRequestError(404, "not_found", CANARY), /workspace is not available/],
    [new ApiRequestError(409, "real_data_gate_closed", CANARY), /does not accept real phone numbers or e-mail addresses yet/],
    [new ApiRequestError(409, "conflict", CANARY), /already used/],
    [new ApiRequestError(422, "validation_error", CANARY), /Check the name/],
    [new ApiRequestError(503, "api_unreachable", CANARY), /Could not save/],
    [new Error(CANARY), /Could not save/],
  ])("%s becomes a sentence of our own on the first step, and nothing the API said is echoed", async (error, sentence) => {
    api.createCustomerCompany.mockRejectedValue(error);
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(sentence);
    expect(r?.error).not.toContain("Nothing is added twice");
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("a refusal at the contact step (the gate) says nothing is added twice, and the lead is not tried", async () => {
    api.createContact.mockRejectedValue(new ApiRequestError(409, "real_data_gate_closed", CANARY));
    const r = await run({ phone: "+91 98765 43210" });
    expect(r?.error).toMatch(/does not accept real phone numbers/);
    expect(r?.error).toMatch(/Nothing is added twice if you press the button again/);
    expect(JSON.stringify(r)).not.toContain("98765");
    expect(api.createLead).not.toHaveBeenCalled();
  });
  it("a refusal at the lead step keeps the same ids for the retry", async () => {
    api.createLead.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", CANARY));
    expect((await run())?.ok).toBe(false);
    expect((await run())?.ok).toBe(true);
    expect(api.createContact.mock.calls[0][2].id).toBe(api.createContact.mock.calls[1][2].id);
    expect(api.createLead.mock.calls[1][2].id).toBe(LD);
  });
});
