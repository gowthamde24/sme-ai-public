import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { parseWorkspacePack } from "@/lib/api/pack";
import { formFields } from "@/lib/packs/form-fields";

import { CustomFieldsInputs, type FieldValues } from "./CustomFieldsInputs";
import { FieldsSection } from "./FieldsSection";

const t = appT("en");
afterEach(cleanup);
const construction = parseWorkspacePack({ pack: "construction" });
const owner = (over: object) => ({ id: "x1", entity: "contact", code: "gate_code", kind: "text", label: { en: "Gate code" }, pii_class: "none", source: "owner", active: true, ...over });

const section = (over: Partial<React.ComponentProps<typeof FieldsSection>> = {}) =>
  render(<FieldsSection fields={construction.fields} entities={["contact", "catalogue_item"]} source="api" canEdit notice={null} lang="en" add={vi.fn(async () => undefined)} setActive={vi.fn(async () => undefined)} t={t} {...over} />);

describe("Settings → Fields", () => {
  it("lists the fields of each kind of record with their kind, a mark for the ones that came with the business type, required, and personal data", () => {
    section({ fields: parseWorkspacePack({ pack: "education" }).fields.concat(parseWorkspacePack({ pack: "construction", fields: [owner({ id: "x1" }), owner({ id: "x2", code: "hidden_one", label: { en: "Old note" }, active: false })] }).fields) });
    const contacts = within(screen.getByRole("region", { name: "Customers and contacts" }));
    expect(contacts.getByText("Relation to the student")).toBeInTheDocument();
    expect(contacts.getAllByText("From your business type").length).toBeGreaterThanOrEqual(2);
    expect(contacts.getByText("Personal data")).toBeInTheDocument();
    expect(contacts.getByText("Gate code")).toBeInTheDocument();
    expect(screen.getByText("Gate code").closest("li")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Gate code").closest("li")!.querySelector("button")).toHaveTextContent("Hide");
    expect(document.querySelector("[data-field='hidden_one'] button")).toHaveTextContent("Show again");
  });
  it("a field that came with the business type can be seen but has no Hide button (it has no id of its own)", () => {
    section();
    expect(document.querySelector("[data-field='customer_type'] button")).toBeNull();
    expect(screen.getByText("Product type").closest("li")).toHaveTextContent("Required");
  });
  it("counts the fields in use against the limit of 20", () => {
    section();
    expect(within(screen.getByRole("region", { name: "Catalogue items" })).getByText("15 of 20 in use")).toBeInTheDocument();
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
  it("while the server cannot keep fields it says 'Not available yet' in place of the form and explains, and hides nothing it has", () => {
    section({ source: "fixture" });
    expect(screen.getByText(/cannot be saved yet on this system/)).toBeInTheDocument();
    expect(document.querySelector("[data-fields='not-available']")).toHaveTextContent("Not available yet");
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
    expect(screen.getByText("Product type")).toBeInTheDocument();
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
  const fields = formFields(construction.fields, "catalogue_item", "en");
  function Harness({ initial = {}, onChange = () => undefined }: { initial?: FieldValues; onChange?: (v: FieldValues) => void }) {
    const [v, setV] = useState<FieldValues>(initial);
    return <CustomFieldsInputs fields={fields} values={v} onChange={(n) => { setV(n); onChange(n); }} words={{ title: "More details", yes: "Yes", no: "No", pick: "Choose…" }} idPrefix="t" />;
  }
  it("draws one input of the right kind for each field: a choice is a select, a number takes decimals, text is limited to 100", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "More details" })).toBeInTheDocument();
    const select = screen.getByLabelText("Product type");
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Choose…");
    expect(screen.getByLabelText("Pieces per sq ft")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText(/^Size/)).toHaveAttribute("maxlength", "100");
    expect(screen.getByLabelText("Product type")).toBeRequired();
  });
  it("tells the form about every change, with the code of the field as the key", () => {
    const seen: FieldValues[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);
    fireEvent.change(screen.getByLabelText("Product type"), { target: { value: "brick" } });
    fireEvent.change(screen.getByLabelText(/^Size/), { target: { value: "200x100" } });
    fireEvent.change(screen.getByLabelText(/^Size/), { target: { value: "" } });
    expect(seen.at(-3)).toMatchObject({ product_type: "brick" });
    expect(seen.at(-2)).toMatchObject({ product_type: "brick", size: "200x100" });
    expect(seen.at(-1)).toMatchObject({ size: null }); // a cleared answer is null, which the server leaves out
  });
  it("starts from the values the item has", () => {
    render(<Harness initial={{ product_type: "tile", size: "600x600" }} />);
    expect(screen.getByLabelText("Product type")).toHaveValue("tile");
    expect(screen.getByLabelText(/^Size/)).toHaveValue("600x600");
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
