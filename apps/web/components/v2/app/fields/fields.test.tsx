import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { formFields } from "@/lib/packs/form-fields";
import { packFields, packWithFields } from "@/lib/packs/pack-test-kit";
import type { WorkspaceField } from "@/lib/packs/types";

import { CustomFieldsInputs, type FieldValues } from "./CustomFieldsInputs";
import { FieldsSection } from "./FieldsSection";

const t = appT("en");
afterEach(cleanup);
// the real fields of the business types that have some (packages/packs, through the API's shapes)
const itemPack = packWithFields("catalogue_item", 5);
const fields = packFields(itemPack);
const itemFields = fields.filter((f) => f.entity === "catalogue_item");
const contactFields = fields.filter((f) => f.entity === "contact");
const owner = (over: Partial<WorkspaceField>): WorkspaceField => ({ id: "x1", entity: "contact", code: "gate_code", kind: "text", label: { en: "Gate code" }, choices: null, required: false, position: 99, piiClass: "none", mergeable: false, active: true, source: "owner", ...over });

const section = (over: Partial<React.ComponentProps<typeof FieldsSection>> = {}) =>
  render(<FieldsSection fields={fields} entities={["contact", "catalogue_item"]} available canEdit notice={null} lang="en" add={vi.fn(async () => undefined)} setActive={vi.fn(async () => undefined)} t={t} {...over} />);

describe("Settings → Fields", () => {
  it("lists the fields of each kind of record with their kind, a mark for the ones that came with the business type, required, and personal data", () => {
    section({ fields: [...fields, owner({ id: "x1" }), owner({ id: "x2", code: "hidden_one", label: { en: "Old note" }, active: false }), owner({ id: "x3", code: "relation_x", label: { en: "Relation" }, piiClass: "personal", required: true })] });
    const contacts = within(screen.getByRole("region", { name: "Customers and contacts" }));
    expect(contacts.getByText(contactFields[0].label.en)).toBeInTheDocument();
    expect(contacts.getAllByText("From your business type").length).toBeGreaterThanOrEqual(2);
    expect(contacts.getByText("Personal data")).toBeInTheDocument();
    expect(contacts.getByText("Required")).toBeInTheDocument();
    expect(contacts.getByText("Gate code")).toBeInTheDocument();
    expect(screen.getByText("Gate code").closest("li")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Gate code").closest("li")!.querySelector("button")).toHaveTextContent("Hide");
    expect(document.querySelector("[data-field='hidden_one'] button")).toHaveTextContent("Show again");
  });
  it("any field can be hidden and shown again (nothing is ever deleted), and the form says which one with its id", () => {
    section();
    const first = document.querySelector(`[data-field='${contactFields[0].code}']`)!;
    expect(first.querySelector("button")).toHaveTextContent("Hide");
    expect(first.querySelector("input[name='field_id']")).toHaveAttribute("value", contactFields[0].id);
  });
  it("counts the fields in use against the limit of 20", () => {
    section();
    expect(within(screen.getByRole("region", { name: "Catalogue items" })).getByText(`${itemFields.filter((f) => f.active).length} of 20 in use`)).toBeInTheDocument();
  });
  it("the form adds a field: the record type, the name, the kind, the choices and 'required', and warns what not to use fields for", () => {
    section();
    const form = screen.getByRole("region", { name: "Add a field" });
    expect(within(form).getByText(/health, religion, caste, income, Aadhaar/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Add it to")).toBeInTheDocument();
    expect(within(form).getByLabelText("Name of the field")).toBeRequired();
    expect(within(form).getAllByRole("option").map((o) => o.textContent)).toEqual(["Customers and contacts", "Catalogue items", "Text", "Number", "Date", "Choice", "Yes or no"]);
    expect(within(form).getByLabelText(/Choices/)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Add field" })).toBeInTheDocument();
  });
  it("while the server cannot keep fields (it did not answer the field routes) it says 'Not available yet' in place of the form, and hides nothing it has", () => {
    section({ available: false });
    expect(document.querySelector("[data-fields='not-available']")).toHaveTextContent("Not available yet");
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
    expect(screen.getByText(itemFields[0].label.en)).toBeInTheDocument();
  });
  it("shows nothing to change to someone who may not change fields", () => {
    section({ canEdit: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: "Add a field" })).toBeNull();
  });
  it("shows only the kinds of record the business has (no catalogue: no catalogue fields)", () => {
    section({ entities: ["contact"] });
    expect(screen.queryByRole("region", { name: "Catalogue items" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Add a field" })).getAllByRole("option").map((o) => o.textContent)).not.toContain("Catalogue items");
  });
  it.each([["added", "status"], ["updated", "status"], ["unavailable", "alert"], ["mfa", "alert"], ["invalid", "alert"], ["role", "alert"], ["limit", "alert"], ["failed", "alert"]] as const)("says what happened after '%s'", (notice, role) => {
    section({ notice });
    expect(screen.getByRole(role)).toBeInTheDocument();
  });
});

describe("the extra fields on a form", () => {
  const formRows = formFields(fields, "catalogue_item", "en");
  const choice = itemFields.find((f) => f.kind === "choice")!;
  const text = itemFields.find((f) => f.kind === "text")!;
  const number = itemFields.find((f) => f.kind === "number")!;
  const nameRe = (f: WorkspaceField) => new RegExp(`^${f.label.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  function Harness({ initial = {}, onChange = () => undefined }: { initial?: FieldValues; onChange?: (v: FieldValues) => void }) {
    const [v, setV] = useState<FieldValues>(initial);
    return <CustomFieldsInputs fields={formRows} values={v} onChange={(n) => { setV(n); onChange(n); }} words={{ title: "More details", yes: "Yes", no: "No", pick: "Choose…" }} idPrefix="t" />;
  }
  it("draws one input of the right kind for each field: a choice is a select, a number takes decimals, text is limited to 100", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "More details" })).toBeInTheDocument();
    const select = screen.getByLabelText(choice.label.en);
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Choose…");
    expect(screen.getByLabelText(nameRe(number))).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText(nameRe(text))).toHaveAttribute("maxlength", "100");
    expect(select).not.toBeRequired(); // none of the pack's own fields is required
  });
  it("tells the form about every change, with the code of the field as the key", () => {
    const seen: FieldValues[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);
    const pick = choice.choices![0].code;
    fireEvent.change(screen.getByLabelText(choice.label.en), { target: { value: pick } });
    fireEvent.change(screen.getByLabelText(nameRe(text)), { target: { value: "200x100" } });
    fireEvent.change(screen.getByLabelText(nameRe(text)), { target: { value: "" } });
    expect(seen.at(-3)).toMatchObject({ [choice.code]: pick });
    expect(seen.at(-2)).toMatchObject({ [choice.code]: pick, [text.code]: "200x100" });
    expect(seen.at(-1)).toMatchObject({ [text.code]: null }); // a cleared answer is null, which the server leaves out
  });
  it("starts from the values the item has", () => {
    const pick = choice.choices![1].code;
    render(<Harness initial={{ [choice.code]: pick, [text.code]: "600x600" }} />);
    expect(screen.getByLabelText(choice.label.en)).toHaveValue(pick);
    expect(screen.getByLabelText(nameRe(text))).toHaveValue("600x600");
  });
  it("draws yes/no as two radio choices and several choices as check boxes", () => {
    const f = [
      { code: "has_gate", kind: "yes_no" as const, label: "Has a gate", required: false, pii: "none" as const },
      { code: "tags_x", kind: "multi_choice" as const, label: "Tags", required: false, pii: "none" as const, choices: [{ code: "a", label: "A" }, { code: "b", label: "B" }] },
    ];
    const onChange = vi.fn();
    const { rerender } = render(<CustomFieldsInputs fields={f} values={{}} onChange={onChange} words={{ title: "More", yes: "Yes", no: "No", pick: "Choose" }} idPrefix="y" />);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(onChange).toHaveBeenLastCalledWith({ has_gate: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    expect(onChange).toHaveBeenLastCalledWith({ tags_x: ["a"] });
    rerender(<CustomFieldsInputs fields={f} values={{ tags_x: ["a", "b"], has_gate: true }} onChange={onChange} words={{ title: "More", yes: "Yes", no: "No", pick: "Choose" }} idPrefix="y" />);
    expect(screen.getByRole("radio", { name: "Yes" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    expect(onChange).toHaveBeenLastCalledWith({ tags_x: ["b"], has_gate: true });
  });
  it("draws nothing for a business type with no fields", () => {
    const { container } = render(<CustomFieldsInputs fields={[]} values={{}} onChange={() => undefined} words={{ title: "x", yes: "Y", no: "N", pick: "P" }} idPrefix="z" />);
    expect(container).toBeEmptyDOMElement();
  });
});
