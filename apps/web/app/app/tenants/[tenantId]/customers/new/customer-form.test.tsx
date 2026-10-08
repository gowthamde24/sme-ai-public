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
  it("after a refusal every field still shows what was typed", async () => {
    await press({ ok: false, error: "That e-mail is already used by another person." });
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Customer's name")).toHaveValue("Synthetic Asha");
    expect(screen.getByLabelText("WhatsApp or phone number")).toHaveValue("+00 90000 20001");
  });
  it("after a duplicate e-mail the typed values stay, the contact id is swapped for the fresh one, and the other ids stay", async () => {
    const FRESH = "77777777-7777-4777-8777-777777777777";
    const action = vi
      .fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>()
      .mockResolvedValueOnce({ ok: false, error: "That e-mail is already used by another person.", nextContactId: FRESH })
      .mockResolvedValueOnce({ ok: true, leadId: IDS.lead, contactId: FRESH, name: "Synthetic Asha" });
    const { container } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
    fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Synthetic Asha" } });
    fireEvent.change(screen.getByLabelText("WhatsApp or phone number"), { target: { value: "+00 90000 20001" } });
    fireEvent.change(screen.getByLabelText("E-mail (optional)"), { target: { value: "dup@x.example.test" } });
    fireEvent.change(screen.getByLabelText("Shop or business name (optional)"), { target: { value: "Asha Silks" } });
    fireEvent.change(screen.getByLabelText("How did the enquiry come?"), { target: { value: "whatsapp" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("That e-mail is already used by another person.");
    // what was typed is all still there; the person only has to fix the e-mail
    expect(screen.getByLabelText("Customer's name")).toHaveValue("Synthetic Asha");
    expect(screen.getByLabelText("E-mail (optional)")).toHaveValue("dup@x.example.test");
    expect(screen.getByLabelText("Shop or business name (optional)")).toHaveValue("Asha Silks");
    expect(screen.getByLabelText("How did the enquiry come?")).toHaveValue("whatsapp");
    expect(container.querySelector('input[name="contact_id"]')).toHaveValue(FRESH);
    expect(container.querySelector('input[name="company_id"]')).toHaveValue(IDS.company);
    expect(container.querySelector('input[name="lead_id"]')).toHaveValue(IDS.lead);
    fireEvent.change(screen.getByLabelText("E-mail (optional)"), { target: { value: "new@x.example.test" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
    expect(action).toHaveBeenCalledTimes(2);
    const first = action.mock.calls[0][1];
    const second = action.mock.calls[1][1];
    expect([first.get("company_id"), first.get("contact_id"), first.get("lead_id")]).toEqual([IDS.company, IDS.contact, IDS.lead]);
    expect([second.get("company_id"), second.get("contact_id"), second.get("lead_id")]).toEqual([IDS.company, FRESH, IDS.lead]); // same company, fresh contact
    expect(second.get("email")).toBe("new@x.example.test");
    expect(second.get("company_name")).toBe("Asha Silks");
    expect(await screen.findByRole("status")).toHaveTextContent("Added Synthetic Asha.");
  });
  describe("a new page render (new ids) never reuses the first customer's state", () => {
    const IDS_B = { company: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contact: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", lead: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const ids = (c: HTMLElement) => ["company_id", "contact_id", "lead_id"].map((n) => (c.querySelector(`input[name="${n}"]`) as HTMLInputElement | null)?.value);
    const type = () => {
      fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Synthetic Asha" } });
      fireEvent.change(screen.getByLabelText("WhatsApp or phone number"), { target: { value: "+00 90000 20001" } });
      fireEvent.change(screen.getByLabelText("E-mail (optional)"), { target: { value: "asha@x.example.test" } });
      fireEvent.change(screen.getByLabelText("Shop or business name (optional)"), { target: { value: "Asha Silks" } });
    };
    it("after a save, new ids from the page give an empty form with the NEW ids (rerender)", async () => {
      const action = vi.fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>(async () => ({ ok: true, leadId: IDS.lead, contactId: IDS.contact, name: "Synthetic Asha" }));
      const { container, rerender } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
      type();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
      expect(await screen.findByRole("status")).toHaveTextContent("Added Synthetic Asha.");
      rerender(<CustomerForm action={action} tenantId={T} ids={IDS_B} />);
      expect(screen.queryByRole("status")).toBeNull(); // not the first customer's success view
      expect(ids(container)).toEqual([IDS_B.company, IDS_B.contact, IDS_B.lead]);
      expect(screen.getByLabelText("Customer's name")).toHaveValue("");
      expect(screen.getByLabelText("WhatsApp or phone number")).toHaveValue("");
      expect(screen.getByLabelText("E-mail (optional)")).toHaveValue("");
      expect(screen.getByLabelText("Shop or business name (optional)")).toHaveValue("");
      expect(screen.getByLabelText("How did the enquiry come?")).toHaveValue("phone_call");
    });
    it("after a duplicate e-mail swapped the contact id, new page ids still win (the swapped id is not carried over)", async () => {
      const FRESH = "77777777-7777-4777-8777-777777777777";
      const action = vi.fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>(async () => ({ ok: false, error: "That e-mail is already used by another person.", nextContactId: FRESH }));
      const { container, rerender } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
      type();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
      await screen.findByRole("alert");
      expect(ids(container)[1]).toBe(FRESH);
      rerender(<CustomerForm action={action} tenantId={T} ids={IDS_B} />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(ids(container)).toEqual([IDS_B.company, IDS_B.contact, IDS_B.lead]);
      expect(screen.getByLabelText("E-mail (optional)")).toHaveValue("");
    });
    it("a re-render with the SAME ids keeps what the person typed and the swapped contact id", async () => {
      const FRESH = "77777777-7777-4777-8777-777777777777";
      const action = vi.fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>(async () => ({ ok: false, error: "That e-mail is already used by another person.", nextContactId: FRESH }));
      const { container, rerender } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
      type();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
      await screen.findByRole("alert");
      rerender(<CustomerForm action={action} tenantId={T} ids={{ ...IDS }} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(ids(container)).toEqual([IDS.company, FRESH, IDS.lead]);
      expect(screen.getByLabelText("E-mail (optional)")).toHaveValue("asha@x.example.test");
    });
    it("'Add another customer' restarts in place: fresh ids, empty fields, no success view, and no navigation", async () => {
      const action = vi.fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>(async () => ({ ok: true, leadId: IDS.lead, contactId: IDS.contact, name: "Synthetic Asha" }));
      const { container } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
      type();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
      await screen.findByRole("status");
      const link = screen.getByRole("link", { name: "Add another customer" });
      expect(link).toHaveAttribute("href", `/app/tenants/${T}/customers/new`); // still a real link (no script, or a new tab)
      const notPrevented = fireEvent.click(link);
      expect(notPrevented).toBe(false); // the click was handled here: the browser does not navigate
      expect(screen.queryByRole("status")).toBeNull();
      const now = ids(container) as string[];
      expect(now.every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))).toBe(true);
      expect(now[0]).not.toBe(IDS.company);
      expect(now[1]).not.toBe(IDS.contact);
      expect(now[2]).not.toBe(IDS.lead);
      expect(screen.getByLabelText("Customer's name")).toHaveValue("");
      expect(screen.getByLabelText("E-mail (optional)")).toHaveValue("");
      // and a second customer is sent with the new ids, never the first customer's
      fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Second Person" } });
      fireEvent.change(screen.getByLabelText("WhatsApp or phone number"), { target: { value: "+00 90000 20002" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
      const second = action.mock.calls[1][1];
      expect([second.get("company_id"), second.get("contact_id"), second.get("lead_id")]).toEqual(now);
    });
  });
  it("a refusal that is not a duplicate keeps all three ids", async () => {
    const action = vi.fn<(prev: CustomerFormState, data: FormData) => Promise<CustomerFormState>>(async () => ({ ok: false, error: "Could not save. Try again." }));
    const { container } = render(<CustomerForm action={action} tenantId={T} ids={IDS} />);
    fireEvent.change(screen.getByLabelText("Customer's name"), { target: { value: "Synthetic Asha" } });
    fireEvent.change(screen.getByLabelText("WhatsApp or phone number"), { target: { value: "+00 90000 20001" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this customer" })));
    await screen.findByRole("alert");
    expect(container.querySelector('input[name="contact_id"]')).toHaveValue(IDS.contact);
  });
  it("an error is an alert of our wording and the form stays", async () => {
    await press({ ok: false, error: "Could not save. Try again." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByRole("button", { name: "Add this customer" })).toBeInTheDocument();
  });
});
