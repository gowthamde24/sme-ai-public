import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomerFormState } from "./actions";
import { CustomerForm } from "./customer-form";

const T = "22222222-2222-2222-2222-222222222222";
const IDS = { company: "33333333-3333-3333-3333-333333333333", contact: "44444444-4444-4444-4444-444444444444", lead: "55555555-5555-4555-8555-555555555555" };
const press = async (state: CustomerFormState) => {
  const action = vi.fn(async () => state);
  render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
  fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Synthetic Asha" } }); // the browser blocks a submit with a required field empty
  fireEvent.change(screen.getByLabelText("WhatsApp or phone number"), { target: { value: "+00 90000 20001" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
  return action;
};

describe("CustomerForm", () => {
  it("sends the page's three ids as hidden fields", () => {
    const { container } = render(<CustomerForm action={vi.fn()} tenantId={T} ids={IDS} />);
    for (const [name, value] of [["company_id", IDS.company], ["contact_id", IDS.contact], ["lead_id", IDS.lead]]) {
      expect(container.querySelector(`input[name="${name}"]`)).toHaveValue(value);
    }
  });
  it("after a save it says what was made, that no consent is recorded, and links the next steps", async () => {
    await press({ ok: true, leadId: IDS.lead, contactId: IDS.contact, name: "Synthetic Asha" });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Added Synthetic Asha.");
    expect(status).toHaveTextContent("No consent is recorded yet");
    expect(screen.getByRole("link", { name: /Record consent for this person/ })).toHaveAttribute("href", `/app/tenants/${T}/contacts/${IDS.contact}/consent`);
    expect(screen.getByRole("link", { name: /Open the lead/ })).toHaveAttribute("href", `/app/tenants/${T}/leads/${IDS.lead}`);
    expect(status.textContent).not.toMatch(/90000|@/);
  });
  it("an error is an alert of our wording and the form stays", async () => {
    await press({ ok: false, error: "Could not save. Try again." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByRole("button", { name: "Add this customer" })).toBeInTheDocument();
  });
});
