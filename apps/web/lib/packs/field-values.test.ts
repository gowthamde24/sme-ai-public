import { describe, expect, it } from "vitest";

import { codeOf, parseChoices } from "./field-codes";
import { normaliseValues } from "./field-values";
import { formFields } from "./form-fields";
import { packFields, packWithFields } from "./pack-test-kit";
import { textIn } from "./text";
import type { WorkspaceField } from "./types";

// the real fields of a business type that has many (packages/packs): products with sizes, units and numbers; customers with a kind and applications
const itemPack = packWithFields("catalogue_item", 5);
const fields: WorkspaceField[] = packFields(itemPack);
const T = (en: string) => ({ en, te: en, hi: en, kn: en });
const own = (over: Partial<WorkspaceField>): WorkspaceField => ({ id: "x", entity: "contact", code: "note_x", kind: "text", label: T("X"), choices: null, required: false, position: 1, piiClass: "none", mergeable: false, active: true, source: "owner", ...over });
const code = (entity: "contact" | "catalogue_item", kind: string) => fields.find((f) => f.entity === entity && f.kind === kind)!;

describe("the values of the extra fields on a form", () => {
  const choiceItem = code("catalogue_item", "choice");
  const textItem = code("catalogue_item", "text");
  const numberItem = code("catalogue_item", "number");
  it("keeps what is valid, in the type the field says, and leaves empty optional values out", () => {
    const r = normaliseValues(fields, "catalogue_item", { [choiceItem.code]: choiceItem.choices![0].code, [textItem.code]: "  200x100  ", [numberItem.code]: "4.5", other_text: "" });
    expect(r.issues).toEqual({});
    expect(r.values).toEqual({ [choiceItem.code]: choiceItem.choices![0].code, [textItem.code]: "200x100", [numberItem.code]: 4.5 });
  });
  it("reports a closed reason for each wrong value and for a missing required one", () => {
    const need = [...fields, own({ entity: "catalogue_item", code: "must_have", required: true })];
    const r = normaliseValues(need, "catalogue_item", { [choiceItem.code]: "marble_that_is_not_there", [numberItem.code]: "lots", [textItem.code]: "x".repeat(101) });
    expect(r.issues).toEqual({ [choiceItem.code]: "not_a_choice", [numberItem.code]: "bad_number", [textItem.code]: "too_long", must_have: "required" });
    expect(r.values).toEqual({});
  });
  it("drops a code that is not a field of this workspace and a field of the other kind of record", () => {
    const contactField = code("contact", "choice");
    const r = normaliseValues(fields, "contact", { [contactField.code]: contactField.choices![0].code, [textItem.code]: "200x100", nonsense: "x", __proto__: "y" });
    expect(r.values).toEqual({ [contactField.code]: contactField.choices![0].code });
    expect(r.issues).toEqual({});
  });
  it("ignores a hidden (inactive) field", () => {
    const hidden = fields.map((f) => (f.code === choiceItem.code ? { ...f, active: false, required: true } : f));
    expect(normaliseValues(hidden, "catalogue_item", { [choiceItem.code]: choiceItem.choices![0].code })).toEqual({ values: {}, issues: {} });
  });
  it("checks dates, yes/no and several choices", () => {
    const all = [own({ code: "visit_on", kind: "date" }), own({ code: "has_gate", kind: "yes_no" }), own({ code: "tags_x", kind: "multi_choice", choices: [{ code: "a", label: T("A") }, { code: "b", label: T("B") }] })];
    expect(normaliseValues(all, "contact", { visit_on: "2026-10-14", has_gate: "yes", tags_x: ["a", "a", "b"] })).toEqual({ values: { visit_on: "2026-10-14", has_gate: true, tags_x: ["a", "b"] }, issues: {} });
    expect(normaliseValues(all, "contact", { visit_on: "2026-02-30", has_gate: "maybe", tags_x: ["c"] }).issues).toEqual({ visit_on: "bad_date", has_gate: "bad_value", tags_x: "not_a_choice" });
    expect(normaliseValues(all, "contact", { visit_on: "14/10/2026" }).issues).toEqual({ visit_on: "bad_date" });
    expect(normaliseValues(all, "contact", { has_gate: false }).values).toEqual({ has_gate: false });
  });
  it("takes anything the browser sent as untrusted: a non-object is no values, a wrong type is a reason, never a crash", () => {
    const c = code("contact", "choice");
    expect(normaliseValues(fields, "contact", "nope")).toEqual({ values: {}, issues: {} });
    expect(normaliseValues(fields, "contact", [1, 2])).toEqual({ values: {}, issues: {} });
    expect(normaliseValues(fields, "contact", { [c.code]: { a: 1 } }).issues).toEqual({ [c.code]: "not_a_choice" });
    expect(normaliseValues(fields, "catalogue_item", { [numberItem.code]: { b: 1 } }).issues).toEqual({ [numberItem.code]: "bad_number" });
    expect(normaliseValues([own({})], "contact", { note_x: 5 }).issues).toEqual({ note_x: "bad_value" });
    expect(normaliseValues([own({ kind: "number" })], "contact", { note_x: Infinity }).issues).toEqual({ note_x: "bad_number" });
  });
});

describe("form fields", () => {
  it("are the active fields of one kind of record in the person's language, with their choices", () => {
    const contacts = fields.filter((f) => f.entity === "contact");
    const rows = formFields([...contacts, { ...contacts[0], code: "hidden_one", active: false }], "contact", "hi");
    expect(rows.map((r) => r.code)).toEqual(contacts.map((f) => f.code));
    expect(rows[0].label).toBe(textIn(contacts[0].label, "hi")); // English where the pack has no Hindi
    expect(rows[0].choices?.[0]).toEqual({ code: contacts[0].choices![0].code, label: textIn(contacts[0].choices![0].label, "hi") });
    expect(rows[0]).toMatchObject({ required: false, pii: "none" });
  });
  it("marks a personal-details field, and speaks English when a language has no text", () => {
    const rows = formFields([own({ piiClass: "personal", label: { en: "Relation" } })], "contact", "kn");
    expect(rows[0]).toMatchObject({ label: "Relation", pii: "personal" });
  });
});

describe("the code of a field an owner adds", () => {
  it("is made from the words: a-z, 0-9 and _, starting with a letter", () => {
    expect(codeOf("Dispatch time")).toBe("dispatch_time");
    expect(codeOf("  GST % (accountant) ")).toBe("gst_accountant");
    expect(codeOf("1 gate")).toMatch(/^field_[a-z0-9]+$/);
    expect(codeOf("గేట్ కోడ్")).toMatch(/^field_[a-z0-9]+$/); // no Latin letters: a stable made-up code, the label keeps the words
    expect(codeOf("x".repeat(80)).length).toBeLessThanOrEqual(36);
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
