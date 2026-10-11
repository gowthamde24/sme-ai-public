import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactLead } from "./ContactLead";
import { SENT, WORDS, fakeContactActions } from "./contact-test-kit";
import { KEEP_RECORD_KEY, resetKeepRecordMemory } from "./use-keep-record";

const BOOK = "/app/tenants/T/visits?lead=L#book";
const TODAY = "/app/tenants/T#needs-you";
const show = async (actions = fakeContactActions(), noContact = false) => {
  await act(async () => void render(<ContactLead words={WORDS} actions={actions} bookHref={BOOK} todayHref={TODAY} addCustomerHref="/app/tenants/T/customers/new" noContact={noContact} />));
  return actions;
};
const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  resetKeepRecordMemory();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("Contact this lead: what is offered", () => {
  it("two ways to reach the lead, a button to book a visit, and the record box ticked", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "Contact this lead" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact on WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a call" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a store visit" })).toHaveAttribute("href", BOOK);
    expect(screen.getByRole("checkbox", { name: /Keep a record of this/ })).toBeChecked();
  });
  it("says it never shows the number, and opens nothing outside the shop's own rules", async () => {
    await show();
    expect(screen.getByText(/You never see the customer's number here\./)).toBeInTheDocument();
    expect(document.querySelector('a[href^="https://wa.me"], a[href^="tel:"], a[href*="whatsapp"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\+?\d[\d ]{9,}/);
  });
  it("a lead with no contact says so and offers no way to message or call, but still the visit", async () => {
    await show(fakeContactActions(), true);
    expect(screen.getByRole("note")).toHaveTextContent("This lead has no contact attached");
    expect(screen.getByRole("link", { name: "Add the customer" })).toHaveAttribute("href", "/app/tenants/T/customers/new");
    expect(screen.queryByRole("button", { name: "Contact on WhatsApp" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Book a store visit" })).toBeInTheDocument();
  });
  it("all the buttons are at least 44 px high", async () => {
    await show();
    for (const el of [screen.getByRole("button", { name: "Contact on WhatsApp" }), screen.getByRole("button", { name: "Request a call" }), screen.getByRole("link", { name: "Book a store visit" })]) expect(el.className).toContain("min-h-11");
  });
});

describe("Contact on WhatsApp", () => {
  it("opens a form for the words, the language and what it is about, and nothing is sent until it is submitted", async () => {
    const actions = await show();
    await click("Contact on WhatsApp");
    expect(screen.getByLabelText("Your message")).toBeInTheDocument();
    expect(screen.getByLabelText("Language of the message")).toHaveValue("en");
    expect(screen.getByLabelText("What is it about?")).toHaveValue("info");
    expect(screen.getByRole("button", { name: "Send to the outbox" })).toBeDisabled();
    expect(actions.whatsapp).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing opens WhatsApp. The message goes to the outbox, and the rules there decide.")).toBeInTheDocument();
  });
  it("sends the words with the page's ids, the language, the kind and the record choice (ticked)", async () => {
    const actions = await show();
    await click("Contact on WhatsApp");
    type("Your message", " Hello, we are open today. ");
    type("Language of the message", "te");
    type("What is it about?", "followup");
    await click("Send to the outbox");
    expect(actions.whatsapp).toHaveBeenCalledTimes(1);
    expect(actions.whatsapp).toHaveBeenCalledWith({ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/), touchId: expect.stringMatching(/^[0-9a-f-]{36}$/), text: " Hello, we are open today. ", language: "te", category: "followup", keepRecord: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Sent to the customer.");
    expect(status).toHaveTextContent("A record was added to this lead's history.");
  });
  it("UNTICKED sends keepRecord false and the contact still goes ahead", async () => {
    const actions = await show(fakeContactActions({ whatsapp: vi.fn(async () => ({ ...SENT, record: "off" as const, recordText: "No record was made, as you chose." })) }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Keep a record of this/ }));
    await click("Contact on WhatsApp");
    type("Your message", "Hello");
    await click("Send to the outbox");
    expect(actions.whatsapp.mock.calls[0][0].keepRecord).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("No record was made, as you chose.");
  });
  it("remembers the choice on this device: unticked now, unticked on the next visit", async () => {
    await show();
    fireEvent.click(screen.getByRole("checkbox", { name: /Keep a record of this/ }));
    expect(window.localStorage.getItem(KEEP_RECORD_KEY)).toBe("0");
    cleanup();
    resetKeepRecordMemory();
    await show();
    expect(screen.getByRole("checkbox", { name: /Keep a record of this/ })).not.toBeChecked();
  });
  it("works with storage blocked: ticked, and the contact goes through", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const actions = await show();
    expect(screen.getByRole("checkbox", { name: /Keep a record of this/ })).toBeChecked();
    await click("Contact on WhatsApp");
    type("Your message", "Hello");
    await click("Send to the outbox");
    expect(actions.whatsapp.mock.calls[0][0].keepRecord).toBe(true);
    vi.restoreAllMocks();
  });
  it("a second press of a failed attempt is a retry (same ids); after a success the next message gets new ids and an empty form", async () => {
    const whatsapp = vi.fn().mockResolvedValueOnce({ ok: false, error: "That did not work. Nothing was changed. Try again." }).mockResolvedValue(SENT);
    await show(fakeContactActions({ whatsapp }));
    await click("Contact on WhatsApp");
    type("Your message", "Hello");
    await click("Send to the outbox");
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work.");
    expect(screen.getByLabelText("Your message")).toHaveValue("Hello"); // kept
    await click("Send to the outbox");
    expect(whatsapp.mock.calls[1][0].messageId).toBe(whatsapp.mock.calls[0][0].messageId);
    expect(whatsapp.mock.calls[1][0].touchId).toBe(whatsapp.mock.calls[0][0].touchId);
    expect(screen.queryByLabelText("Your message")).toBeNull(); // closed after the success
    await click("Contact on WhatsApp");
    expect(screen.getByLabelText("Your message")).toHaveValue("");
    type("Your message", "Another");
    await click("Send to the outbox");
    expect(whatsapp.mock.calls[2][0].messageId).not.toBe(whatsapp.mock.calls[0][0].messageId);
  });
  it("each way it can end is said in its own words: waiting for the owner points at Today, queued does not claim to be sent", async () => {
    const states = [
      [{ ...SENT, state: "needs_approval" as const, text: "Waiting for the owner or an admin to approve it.", record: "later" as const, recordText: "No record yet: it is only made once a message has really gone out. You can add one later with “I sent a message”." }, "Waiting for the owner or an admin to approve it."],
      [{ ...SENT, state: "queued" as const, text: "Queued. It goes out at 9:00.", record: "later" as const, recordText: "No record yet" }, "Queued. It goes out at 9:00."],
      [{ ...SENT, state: "blocked" as const, text: "Not sent: The customer asked us to stop. Nothing more is sent.", record: "later" as const, recordText: "No record yet" }, "Not sent:"],
    ] as const;
    for (const [result, text] of states) {
      const actions = fakeContactActions({ whatsapp: vi.fn(async () => result) });
      await show(actions);
      await click("Contact on WhatsApp");
      type("Your message", "Hello");
      await click("Send to the outbox");
      expect(screen.getByRole("status")).toHaveTextContent(text);
      expect(screen.getByRole("status")).not.toHaveTextContent(/^Sent to the customer/);
      if (result.state === "needs_approval") expect(within(screen.getByRole("status")).getByRole("link", { name: "Open Today" })).toHaveAttribute("href", TODAY);
      cleanup();
    }
  });
});

describe("Request a call", () => {
  it("asks for a reason and what to say, and sends the request with its own id", async () => {
    const actions = await show();
    await click("Request a call");
    expect(screen.getByRole("button", { name: "Ask the owner to approve the call" })).toBeDisabled();
    type("Why call?", "Wants to talk about a large order");
    type("What to say on the call", "Hello, this is the shop.");
    type("Language of the call", "hi");
    await click("Ask the owner to approve the call");
    expect(actions.call).toHaveBeenCalledWith({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), reason: "Wants to talk about a large order", script: "Hello, this is the shop.", language: "hi" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Requested. The owner decides on Today. Nobody is called until then.");
    expect(within(status).getByRole("link", { name: "Open Today" })).toHaveAttribute("href", TODAY);
    expect(actions.whatsapp).not.toHaveBeenCalled();
  });
  it("a call request is not a record whatever the box says", async () => {
    await show();
    await click("Request a call");
    type("Why call?", "A reason");
    type("What to say on the call", "Hello");
    await click("Ask the owner to approve the call");
    expect(screen.getByRole("status")).toHaveTextContent("A call request is not a record");
  });
  it("a refusal is shown and nothing is cleared", async () => {
    const call = vi.fn(async () => ({ ok: false as const, error: "Your role does not allow this. Nothing was changed." }));
    await show(fakeContactActions({ call }));
    await click("Request a call");
    type("Why call?", "A reason");
    type("What to say on the call", "Hello");
    await click("Ask the owner to approve the call");
    expect(screen.getByRole("alert")).toHaveTextContent("Your role does not allow this.");
    expect(screen.getByLabelText("Why call?")).toHaveValue("A reason");
  });
  it("switching between the two forms clears the old answer", async () => {
    await show();
    await click("Contact on WhatsApp");
    type("Your message", "Hello");
    await click("Send to the outbox");
    expect(screen.getByRole("status")).toBeInTheDocument();
    await click("Request a call");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
