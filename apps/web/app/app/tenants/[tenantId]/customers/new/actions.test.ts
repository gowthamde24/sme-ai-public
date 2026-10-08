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
    [new ApiRequestError(409, "conflict", CANARY), /already saved with different details/],
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
  it.each([
    [new ApiRequestError(409, "duplicate_value", CANARY), /^That e-mail is already used by another person\./],
    [new ApiRequestError(409, "conflict", CANARY), /^This customer was already saved with different details\./],
    [new ApiRequestError(409, "real_data_gate_closed", CANARY), /^This workspace does not accept real phone numbers/],
    [new ApiRequestError(409, "contact_suppressed", CANARY), /^This person is on the do-not-contact list/],
    [new ApiRequestError(409, "token_expiring", CANARY), /^Your session is about to expire\. Sign in again/],
    [new ApiRequestError(409, "archived", CANARY), /^This could not be saved right now\./],
    [new ApiRequestError(409, "something_new", CANARY), /^This could not be saved right now\./],
    [new ApiRequestError(422, "validation_error", CANARY), /^Check the name, the number/],
    [new ApiRequestError(422, "invalid_reference", CANARY), /^Something this customer depends on is no longer there\./],
    [new ApiRequestError(422, "invalid_value", CANARY), /^A value was not accepted\./],
    [new ApiRequestError(422, "something_new", CANARY), /^Check the name, the number/],
    [new ApiRequestError(429, "rate_limited", CANARY), /^Too many requests\./],
    [new ApiRequestError(403, "forbidden", CANARY), /^Your role cannot add customers\./],
    [new ApiRequestError(404, "not_found", CANARY), /^This workspace is not available\./],
    [new ApiRequestError(503, "api_unreachable", CANARY), /^Could not save\. Try again\./],
  ])("%s gets its own plain sentence at every step, and never the wrong 'form was already used' one", async (error, sentence) => {
    for (const step of ["company", "contact", "lead"] as const) {
      vi.clearAllMocks();
      requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
      api.createCustomerCompany.mockResolvedValue(undefined);
      api.createContact.mockResolvedValue(CT);
      api.createLead.mockResolvedValue(LD);
      ({ company: api.createCustomerCompany, contact: api.createContact, lead: api.createLead })[step].mockRejectedValue(error);
      const r = await run();
      expect(r?.ok).toBe(false);
      expect(r?.error).toMatch(sentence);
      expect(r?.error).not.toMatch(/form was already used/);
      expect(JSON.stringify(r)).not.toContain(CANARY);
      // "Nothing is added twice if you press the button again." only where pressing again is the right move, and never after the first step has failed with nothing saved
      const e = error as ApiRequestError;
      const wordsSayReload = e.code === "invalid_reference" || e.code === "contact_suppressed" || (e.status === 409 && !["duplicate_value", "real_data_gate_closed", "token_expiring"].includes(e.code));
      const expectNote = step !== "company" && !wordsSayReload;
      expect(/Nothing is added twice if you press the button again\./.test(r?.error ?? "")).toBe(expectNote);
    }
  });
  it("the conflict sentence stands alone: it says to reload and check the Contacts list, and does not also say pressing again is safe", async () => {
    const exact = "This customer was already saved with different details. Reload the page and look in the Contacts list before adding again.";
    api.createContact.mockRejectedValue(new ApiRequestError(409, "conflict", CANARY));
    expect((await run())?.error).toBe(exact); // company saved, contact conflicts
    api.createContact.mockResolvedValue(CT);
    api.createLead.mockRejectedValue(new ApiRequestError(409, "conflict", CANARY));
    expect((await run())?.error).toBe(exact); // company and contact saved, lead conflicts
    api.createCustomerCompany.mockRejectedValue(new ApiRequestError(409, "conflict", CANARY));
    expect((await run())?.error).toBe(exact); // first step
  });
  it("where pressing again IS safe the note stays: a duplicate e-mail, the gate, and a network failure after the company was saved", async () => {
    for (const error of [new ApiRequestError(409, "duplicate_value", CANARY), new ApiRequestError(409, "real_data_gate_closed", CANARY), new ApiRequestError(503, "api_unreachable", CANARY)]) {
      api.createContact.mockRejectedValue(error);
      expect((await run())?.error).toMatch(/Nothing is added twice if you press the button again\.$/);
    }
  });
  it("a rejected session goes to sign-in at every step", async () => {
    for (const step of ["company", "contact", "lead"] as const) {
      vi.clearAllMocks();
      requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
      api.createCustomerCompany.mockResolvedValue(undefined);
      api.createContact.mockResolvedValue(CT);
      api.createLead.mockResolvedValue(LD);
      ({ company: api.createCustomerCompany, contact: api.createContact, lead: api.createLead })[step].mockRejectedValue(new ApiAuthError("no"));
      expect(await redirectTarget(() => run())).toBe("/login");
    }
  });
  it("a duplicate e-mail says so in plain words and hands back a FRESH contact id; no lead is tried", async () => {
    api.createContact.mockRejectedValue(new ApiRequestError(409, "duplicate_value", CANARY));
    const r = await run({ email: "dup@x.example.test" });
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(/^That e-mail is already used by another person\./);
    expect(r?.error).not.toMatch(/already used\. Reload|This form was already used/);
    expect(r?.nextContactId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r?.nextContactId).not.toBe(CT);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(JSON.stringify(r)).not.toContain("dup@x");
    expect(api.createLead).not.toHaveBeenCalled();
  });
  it("only a duplicate e-mail at the contact step gets a fresh contact id; every other failure keeps the ids", async () => {
    api.createContact.mockRejectedValue(new ApiRequestError(409, "real_data_gate_closed", CANARY));
    expect((await run())?.nextContactId).toBeUndefined();
    api.createContact.mockRejectedValue(new ApiRequestError(503, "api_unreachable", CANARY));
    expect((await run())?.nextContactId).toBeUndefined();
    api.createContact.mockResolvedValue(CT);
    api.createLead.mockRejectedValue(new ApiRequestError(409, "duplicate_value", CANARY));
    expect((await run())?.nextContactId).toBeUndefined(); // the contact WAS made: its id must be kept, or a retry would hit the same e-mail
  });
  it("after a duplicate e-mail, the corrected resubmit reuses the company id (it replays) and uses the fresh contact id, and makes the lead", async () => {
    api.createContact.mockRejectedValueOnce(new ApiRequestError(409, "duplicate_value", CANARY));
    const first = await run({ email: "dup@x.example.test" });
    const fresh = first?.nextContactId as string;
    const second = await run({ email: "new@x.example.test", contact_id: fresh });
    expect(second).toEqual({ ok: true, leadId: LD, contactId: fresh, name: "Synthetic Asha" });
    const [c1, c2] = api.createCustomerCompany.mock.calls;
    expect(c1[2].id).toBe(CO);
    expect(c2[2].id).toBe(CO); // the same company id: the API replays it, no second company
    expect(api.createContact.mock.calls[1][2]).toMatchObject({ id: fresh, companyId: CO, email: "new@x.example.test" });
    expect(api.createLead).toHaveBeenCalledWith("tok", T, { id: LD, companyId: CO, contactId: fresh, source: "whatsapp" });
  });
  it("a refusal at the lead step keeps the same ids for the retry", async () => {
    api.createLead.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", CANARY));
    expect((await run())?.ok).toBe(false);
    expect((await run())?.ok).toBe(true);
    expect(api.createContact.mock.calls[0][2].id).toBe(api.createContact.mock.calls[1][2].id);
    expect(api.createLead.mock.calls[1][2].id).toBe(LD);
  });
});
