import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { createCustomField, getCatalogueCustom, getContactCustom, parseValues, putCatalogueCustom, putContactCustom, setCustomFieldActive } from "./custom-fields";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const FIELD = { id: "f1", entity: "contact", code: "gate_code", kind: "text", label: { en: "Gate code" }, pii_class: "none", source: "owner", active: true };
beforeEach(() => vi.clearAllMocks());

describe("custom field values", () => {
  it("reads strings, numbers, booleans, null and lists of choice codes", () => {
    expect(parseValues({ values: { a1: "x", b1: 4, c1: true, d1: null, e1: ["p", "q"] } })).toEqual({ a1: "x", b1: 4, c1: true, d1: null, e1: ["p", "q"] });
  });
  it.each([[null], [[]], [{}], [{ values: [] }], [{ values: { "Bad Code": 1 } }], [{ values: { ab: {} } }], [{ values: { ab: [1] } }]])("%j is a contract error", (json) => {
    expect(() => parseValues(json)).toThrow(ApiContractError);
  });
  it("puts a contact's values at the contact's own path, as { values }", async () => {
    apiRequest.mockResolvedValue({ values: { customer_type: "builder" } });
    expect(await putContactCustom("tok", T, C, { customer_type: "builder" })).toEqual({ customer_type: "builder" });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/contacts/${C}/custom`, "tok", { method: "PUT", body: JSON.stringify({ values: { customer_type: "builder" } }) });
    await getContactCustom("tok", T, C);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/contacts/${C}/custom`, "tok");
  });
  it("puts and reads a catalogue item's values at the item's own path", async () => {
    apiRequest.mockResolvedValue({ values: {} });
    await putCatalogueCustom("tok", T, C, { size: "200x100" });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/catalogue/${C}/custom`, "tok", { method: "PUT", body: JSON.stringify({ values: { size: "200x100" } }) });
    await getCatalogueCustom("tok", T, C);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/catalogue/${C}/custom`, "tok");
  });
});

describe("custom field definitions", () => {
  it("adds a field of the owner's own: the label as { en }, personal-data class 'none' unless said, choices with codes", async () => {
    apiRequest.mockResolvedValue(FIELD);
    const f = await createCustomField("tok", T, { entity: "contact", code: "gate_code", kind: "choice", label: "Gate code", choices: [{ code: "a", label: "A" }, { code: "b", label: "B" }] });
    expect(f).toMatchObject({ id: "f1", source: "owner" });
    const [path, token, init] = apiRequest.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/custom-fields`);
    expect(token).toBe("tok");
    expect(JSON.parse(init.body)).toEqual({ entity: "contact", code: "gate_code", kind: "choice", label: { en: "Gate code" }, required: false, pii_class: "none", choices: [{ code: "a", label: { en: "A" } }, { code: "b", label: { en: "B" } }] });
  });
  it("hides and shows a field with PATCH; a field is never deleted", async () => {
    apiRequest.mockResolvedValue({ ...FIELD, active: false });
    expect((await setCustomFieldActive("tok", T, "f1", false)).active).toBe(false);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/custom-fields/f1`, "tok", { method: "PATCH", body: JSON.stringify({ active: false }) });
  });
  it("refuses a malformed field in the answer", async () => {
    apiRequest.mockResolvedValue({ ...FIELD, kind: "colour" });
    await expect(setCustomFieldActive("tok", T, "f1", true)).rejects.toThrow(ApiContractError);
  });
});
