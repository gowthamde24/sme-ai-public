import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { createCustomField, getCatalogueCustom, getContactCustom, listCustomFields, parseFieldDef, parseValues, putCatalogueCustom, putContactCustom, setCustomFieldActive } from "./custom-fields";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const FIELD = { id: "f1", entity: "contact", code: "gate_code", label: { en: "Gate code" }, kind: "text", choices: null, required: false, position: 1, pii_class: "none", mergeable: false, active: true, source: "owner" };
beforeEach(() => vi.clearAllMocks());

describe("custom field values (GET/PUT .../custom)", () => {
  it("reads the values the API lists by code: strings, numbers, booleans, null and lists of choice codes", () => {
    const body = { entity: "contact", entity_id: C, values: [{ code: "a1", kind: "text", active: true, value: "x" }, { code: "b1", kind: "number", active: true, value: 4 }, { code: "c1", kind: "yes_no", active: true, value: true }, { code: "d1", kind: "date", active: false, value: null }, { code: "e1", kind: "multi_choice", active: true, value: ["p", "q"] }] };
    expect(parseValues(body)).toEqual({ a1: "x", b1: 4, c1: true, d1: null, e1: ["p", "q"] });
  });
  it.each([[null], [[]], [{}], [{ values: {} }], [{ values: [{ code: "Bad Code", value: 1 }] }], [{ values: [{ code: "ab", value: {} }] }], [{ values: [{ code: "ab", value: [1] }] }]])("%j is a contract error", (json) => {
    expect(() => parseValues(json)).toThrow(ApiContractError);
  });
  it("puts a contact's values at the contact's own path, as { values: { code: value } }", async () => {
    apiRequest.mockResolvedValue({ entity: "contact", entity_id: C, values: [{ code: "customer_kind", kind: "choice", active: true, value: "builder" }] });
    expect(await putContactCustom("tok", T, C, { customer_kind: "builder" })).toEqual({ customer_kind: "builder" });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/contacts/${C}/custom`, "tok", { method: "PUT", body: JSON.stringify({ values: { customer_kind: "builder" } }) });
    await getContactCustom("tok", T, C);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/contacts/${C}/custom`, "tok");
  });
  it("puts and reads a catalogue item's values at the item's own path", async () => {
    apiRequest.mockResolvedValue({ entity: "catalogue_item", entity_id: C, values: [] });
    await putCatalogueCustom("tok", T, C, { size: "200x100" });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/catalogue/${C}/custom`, "tok", { method: "PUT", body: JSON.stringify({ values: { size: "200x100" } }) });
    await getCatalogueCustom("tok", T, C);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/catalogue/${C}/custom`, "tok");
  });
});

describe("custom field definitions", () => {
  it("lists them, active and not, in the order the API gives (by position)", async () => {
    apiRequest.mockResolvedValue({ fields: [{ ...FIELD, id: "b", position: 2 }, { ...FIELD, id: "a", position: 1, active: false }] });
    expect((await listCustomFields("tok", T, "contact")).map((f) => [f.id, f.active])).toEqual([["a", false], ["b", true]]);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/custom-fields?entity=contact`, "tok");
    await listCustomFields("tok", T);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/custom-fields`, "tok");
  });
  it("adds a field of the owner's own: the label as { en }, no class sent (the API makes it 'none'), choices with codes", async () => {
    apiRequest.mockResolvedValue({ ...FIELD, kind: "choice", choices: [{ code: "a", label: { en: "A" } }, { code: "b", label: { en: "B" } }] });
    const f = await createCustomField("tok", T, { entity: "contact", code: "gate_code", kind: "choice", label: "Gate code", choices: [{ code: "a", label: "A" }, { code: "b", label: "B" }] });
    expect(f).toMatchObject({ id: "f1", source: "owner", piiClass: "none" });
    const [path, token, init] = apiRequest.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/custom-fields`);
    expect(token).toBe("tok");
    expect(JSON.parse(init.body)).toEqual({ entity: "contact", code: "gate_code", kind: "choice", label: { en: "Gate code" }, required: false, choices: [{ code: "a", label: { en: "A" } }, { code: "b", label: { en: "B" } }] });
  });
  it("hides and shows a field with PATCH; a field is never deleted", async () => {
    apiRequest.mockResolvedValue({ ...FIELD, active: false });
    expect((await setCustomFieldActive("tok", T, "f1", false)).active).toBe(false);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/custom-fields/f1`, "tok", { method: "PATCH", body: JSON.stringify({ active: false }) });
  });
  it.each([["a kind we do not know", { kind: "colour" }], ["a class we do not know", { pii_class: "child" }], ["a source we do not know", { source: "robot" }], ["a choice field with no choices", { kind: "choice", choices: null }], ["choices on a text field", { choices: [{ code: "a", label: { en: "A" } }] }], ["no id", { id: "" }], ["a code with capitals", { code: "Gate" }], ["a label with no English", { label: { te: "x" } }]])("refuses %s in the answer", (_name, patch) => {
    expect(() => parseFieldDef({ ...FIELD, ...patch })).toThrow(ApiContractError);
  });
});
