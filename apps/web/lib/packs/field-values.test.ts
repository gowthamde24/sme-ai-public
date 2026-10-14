import { describe, expect, it } from "vitest";

import { codeOf, parseChoices } from "./field-codes";
import { normaliseValues } from "./field-values";
import { formFields } from "./form-fields";
import { PACKS, textIn } from "./registry";
import type { WorkspaceField } from "./types";

const construction = PACKS.find((p) => p.fields.length > 10)!;
const fields: WorkspaceField[] = construction.fields.map((f) => ({ ...f, id: null, source: "pack" as const, active: true }));
const T = (en: string) => ({ en, te: en, hi: en, kn: en });
const own = (over: Partial<WorkspaceField>): WorkspaceField => ({ id: "x", entity: "contact", code: "note_x", kind: "text", label: T("X"), pii_class: "none", source: "owner", active: true, ...over });

describe("the values of the extra fields on a form", () => {
  it("keeps what is valid, in the type the field says, and leaves empty optional values out", () => {
    const r = normaliseValues(fields, "catalogue_item", { product_type: "paver_block", selling_unit: "sqft", size: "  200x100  ", pieces_per_sqft: "4.5", minimum_order: 100, colour: "", finish: null, thickness_mm: "80" });
    expect(r.issues).toEqual({});
    expect(r.values).toEqual({ product_type: "paver_block", selling_unit: "sqft", size: "200x100", pieces_per_sqft: 4.5, minimum_order: 100, thickness_mm: "80" });
  });
  it("reports a closed reason for each wrong value and for a missing required one", () => {
    const r = normaliseValues(fields, "catalogue_item", { product_type: "marble", pieces_per_sqft: "lots", size: "x".repeat(101) });
    expect(r.issues).toEqual({ product_type: "not_a_choice", selling_unit: "required", pieces_per_sqft: "bad_number", size: "too_long" });
    expect(r.values).toEqual({});
  });
  it("drops a code that is not a field of this workspace and a field of the other kind of record", () => {
    const r = normaliseValues(fields, "contact", { customer_type: "builder", size: "200x100", nonsense: "x", __proto__: "y" });
    expect(r.values).toEqual({ customer_type: "builder" });
    expect(r.issues).toEqual({});
  });
  it("ignores a hidden (inactive) field", () => {
    const hidden = fields.map((f) => (f.code === "customer_type" ? { ...f, active: false, required: true } : f));
    expect(normaliseValues(hidden, "contact", { customer_type: "builder" })).toEqual({ values: {}, issues: {} });
  });
  it("checks dates, yes/no and several choices", () => {
    const all = [own({ code: "visit_on", kind: "date" }), own({ code: "has_gate", kind: "yes_no" }), own({ code: "tags_x", kind: "multi_choice", choices: [{ code: "a", label: T("A") }, { code: "b", label: T("B") }] })];
    expect(normaliseValues(all, "contact", { visit_on: "2026-10-14", has_gate: "yes", tags_x: ["a", "a", "b"] })).toEqual({ values: { visit_on: "2026-10-14", has_gate: true, tags_x: ["a", "b"] }, issues: {} });
    expect(normaliseValues(all, "contact", { visit_on: "2026-02-30", has_gate: "maybe", tags_x: ["c"] }).issues).toEqual({ visit_on: "bad_date", has_gate: "bad_value", tags_x: "not_a_choice" });
    expect(normaliseValues(all, "contact", { visit_on: "14/10/2026" }).issues).toEqual({ visit_on: "bad_date" });
    expect(normaliseValues(all, "contact", { has_gate: false }).values).toEqual({ has_gate: false });
  });
  it("takes anything the browser sent as untrusted: a non-object is no values, a wrong type is a reason, never a crash", () => {
    expect(normaliseValues(fields, "contact", "nope")).toEqual({ values: {}, issues: {} });
    expect(normaliseValues(fields, "contact", [1, 2])).toEqual({ values: {}, issues: {} });
    expect(normaliseValues(fields, "contact", { customer_type: { a: 1 }, credit_days: { b: 1 } }).issues).toEqual({ customer_type: "not_a_choice", credit_days: "bad_number" });
    expect(normaliseValues([own({})], "contact", { note_x: 5 }).issues).toEqual({ note_x: "bad_value" });
    expect(normaliseValues([own({ kind: "number" })], "contact", { note_x: Infinity }).issues).toEqual({ note_x: "bad_number" });
  });
});

describe("form fields", () => {
  it("are the active fields of one kind of record in the person's language, with their choices", () => {
    const rows = formFields([...fields.slice(0, 3), { ...fields[0], code: "hidden_one", active: false }], "contact", "hi");
    expect(rows.map((r) => r.code)).toEqual(["customer_type", "credit_days"]);
    expect(rows[0].label).toBe(textIn(construction.fields[0].label, "hi"));
    expect(rows[0].choices?.[0]).toEqual({ code: "contractor", label: "ठेकेदार" });
    expect(rows[1]).toMatchObject({ unit: "days", required: false, pii: "none" });
  });
});

describe("the code of a field an owner adds", () => {
  it("is made from the words: a-z, 0-9 and _, starting with a letter", () => {
    expect(codeOf("Dispatch time")).toBe("dispatch_time");
    expect(codeOf("  GST % (accountant) ")).toBe("gst_accountant");
    expect(codeOf("1 gate")).toMatch(/^field_[a-z0-9]+$/);
    expect(codeOf("గేట్ కోడ్")).toMatch(/^field_[a-z0-9]+$/); // no Latin letters: a stable made-up code, the label keeps the words
    expect(codeOf("x".repeat(80)).length).toBeLessThanOrEqual(28);
    expect(codeOf("గేట్ కోడ్")).toBe(codeOf("గేట్ కోడ్"));
  });
  it("makes unique codes for choices, one per line, between 2 and 20, none over 60 characters", () => {
    expect(parseChoices("Red\nBlue\n\n red ")?.map((c) => c.label)).toEqual(["Red", "Blue", "red"]);
    expect(new Set(parseChoices("A\nA a\nA-a")?.map((c) => c.code)).size).toBe(3);
    expect(parseChoices("only one")).toBeNull();
    expect(parseChoices(Array.from({ length: 21 }, (_, i) => `c${i}`).join("\n"))).toBeNull();
    expect(parseChoices(`ok\n${"x".repeat(61)}`)).toBeNull();
  });
});
