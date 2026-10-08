import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { createContact, createCustomerCompany, createLead, HOW_LABELS } from "./customers";

const T = "22222222-2222-2222-2222-222222222222";
const A = "33333333-3333-3333-3333-333333333333";
const B = "44444444-4444-4444-4444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

describe("createCustomerCompany", () => {
  it("makes a prospect company with the page's id", async () => {
    apiRequest.mockResolvedValue({});
    await createCustomerCompany("tok", T, { id: A, name: "Synthetic Silks" });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/companies`, "tok", { method: "POST", body: JSON.stringify({ id: A, name: "Synthetic Silks", type: "prospect" }) });
  });
  it("refuses malformed ids before any request", async () => {
    await expect(createCustomerCompany("tok", "x", { id: A, name: "n" })).rejects.toThrow(ApiContractError);
    await expect(createCustomerCompany("tok", T, { id: "x", name: "n" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("createContact", () => {
  it("sends a phone and no e-mail key when there is none", async () => {
    apiRequest.mockResolvedValue({ id: B, phone: "+00 90000 20001" });
    expect(await createContact("tok", T, { id: B, companyId: A, fullName: "Synthetic Asha", phone: "+00 90000 20001", email: null })).toBe(B);
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${T}/contacts`);
    expect(token).toBe("tok");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: B, company_id: A, full_name: "Synthetic Asha", phone: "+00 90000 20001" });
  });
  it("sends the e-mail when given", async () => {
    apiRequest.mockResolvedValue({ id: B });
    await createContact("tok", T, { id: B, companyId: A, fullName: "n", phone: "+00 90000 20001", email: "a@b.example.test" });
    expect(JSON.parse(String((apiRequest.mock.calls[0] as [string, string, RequestInit])[2].body)).email).toBe("a@b.example.test");
  });
  it.each([[{}], [{ id: 5 }], [{ id: "x" }], [null], [[]]])("an answer without a proper id (%j) is an error, never a result", async (answer) => {
    apiRequest.mockResolvedValue(answer);
    await expect(createContact("tok", T, { id: B, companyId: A, fullName: "n", phone: "+00 90000 20001", email: null })).rejects.toThrow(ApiContractError);
  });
  it("refuses malformed ids before any request", async () => {
    await expect(createContact("tok", T, { id: "x", companyId: A, fullName: "n", phone: "123", email: null })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("createLead", () => {
  it("links the contact and says how the enquiry came", async () => {
    apiRequest.mockResolvedValue({ id: C });
    expect(await createLead("tok", T, { id: C, companyId: A, contactId: B, source: "whatsapp" })).toBe(C);
    const [path, , init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${T}/leads`);
    expect(JSON.parse(String(init.body))).toEqual({ id: C, company_id: A, contact_id: B, source: "whatsapp" });
  });
  it("refuses malformed ids before any request", async () => {
    await expect(createLead("tok", T, { id: C, companyId: A, contactId: "x", source: "phone_call" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("the words", () => {
  it("names both ways an enquiry comes", () => {
    expect(HOW_LABELS).toEqual({ phone_call: "Phone call", whatsapp: "WhatsApp" });
  });
});
