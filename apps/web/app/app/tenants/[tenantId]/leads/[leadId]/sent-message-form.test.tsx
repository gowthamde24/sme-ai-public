import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SentMessageState } from "./sent-message-actions";
import { SentMessageForm } from "./sent-message-form";

const ID_A = "55555555-5555-4555-8555-555555555555";
const ID_B = "66666666-6666-4666-8666-666666666666";
const T = "22222222-2222-2222-2222-222222222222";
const CONSENT = `/app/tenants/${T}/contacts/44444444-4444-4444-4444-444444444444/consent`; // the page this form must link to
const MAX = "2026-10-08T15:00";
const OK: SentMessageState = { ok: true, channel: "whatsapp", at: "2026-10-08T10:30:00.000Z" };
type Fn = (prev: SentMessageState, data: FormData) => Promise<SentMessageState>;
const mk = (result: SentMessageState = OK) => vi.fn<Fn>(async () => result);
const CONTACT = "44444444-4444-4444-4444-444444444444";
const renderForm = (action: Fn, id = ID_A, contactId: string | null = CONTACT) => render(<SentMessageForm action={action} tenantId={T} touchId={id} maxNow={MAX} contactId={contactId} />);
const choose = (value: string) => fireEvent.change(screen.getByLabelText("Channel"), { target: { value } });
const submit = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Record this" })));
const hidden = (c: HTMLElement) => (c.querySelector('input[name="touch_id"]') as HTMLInputElement).value;

describe("SentMessageForm: nothing is pre-selected, and only outgoing is offered", () => {
  it("the channel starts with nothing chosen and is required; the time is optional and never later than the page's now", () => {
    renderForm(mk());
    expect(screen.getByLabelText("Channel")).toHaveValue("");
    expect(screen.getByLabelText("Channel")).toBeRequired();
    expect((screen.getByRole("option", { name: "Choose one" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByLabelText(/When \(India time\)/)).not.toBeRequired();
    expect(screen.getByLabelText(/When \(India time\)/)).toHaveAttribute("max", MAX);
    expect(screen.getByLabelText(/When \(India time\)/)).toHaveValue("");
  });
  it("offers WhatsApp, Phone call and E-mail, and no way to record a reply", () => {
    renderForm(mk());
    for (const label of ["WhatsApp", "Phone call", "E-mail"]) expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/they replied|incoming|reply/i);
  });
  it("says nothing is sent from here and shows no number or address", () => {
    const { container } = renderForm(mk());
    expect(screen.getByText(/Nothing is sent from here/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/@|\+00|90000/);
  });
});

describe("SentMessageForm: a missing choice blocks the submit", () => {
  it("with nothing chosen the action is not called", async () => {
    const action = mk();
    renderForm(action);
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("a time but no channel: not called", async () => {
    const action = mk();
    renderForm(action);
    fireEvent.change(screen.getByLabelText(/When \(India time\)/), { target: { value: "2026-10-08T09:00" } });
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("a channel alone is enough: called once with the page's id, the channel and an empty time", async () => {
    const action = mk();
    renderForm(action);
    choose("phone");
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect([data.get("touch_id"), data.get("channel"), data.get("happened_at")]).toEqual([ID_A, "phone", ""]);
    expect(data.get("direction")).toBeNull(); // the direction is not part of this form at all
  });
  it("a channel and a time: both are sent", async () => {
    const action = mk();
    renderForm(action);
    choose("email");
    fireEvent.change(screen.getByLabelText(/When \(India time\)/), { target: { value: "2026-10-08T09:00" } });
    await submit();
    const data = action.mock.calls[0][1];
    expect([data.get("channel"), data.get("happened_at")]).toEqual(["email", "2026-10-08T09:00"]);
  });
});

describe("SentMessageForm: the success sentence", () => {
  it("says what was recorded, never that the system sent it, and shows no number or address", async () => {
    const { container } = renderForm(mk());
    choose("whatsapp");
    await submit();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recorded: you sent a message by WhatsApp at");
    expect(status).toHaveTextContent("The follow-up list will show this lead when it is due.");
    expect(status.textContent).not.toMatch(/we sent|was sent|sent by this system|sent for you/i);
    expect(container.textContent).not.toMatch(/@|\+00|90000/);
  });
  it.each([
    ["email", "E-mail"],
    ["phone", "Phone call"],
  ] as const)("names the channel in words (%s)", async (channel, label) => {
    renderForm(mk({ ok: true, channel, at: "2026-10-08T10:30:00.000Z" }));
    choose(channel);
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent(`by ${label} at`);
  });
  it("after a saved message the form is empty again with a FRESH id, and the sentence stays", async () => {
    const action = mk();
    const { container } = renderForm(action);
    choose("whatsapp");
    fireEvent.change(screen.getByLabelText(/When \(India time\)/), { target: { value: "2026-10-08T09:00" } });
    await submit();
    await screen.findByRole("status");
    expect(screen.getByLabelText("Channel")).toHaveValue("");
    expect(screen.getByLabelText(/When \(India time\)/)).toHaveValue("");
    expect(hidden(container)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(hidden(container)).not.toBe(ID_A);
    expect(screen.getByRole("status")).toBeInTheDocument();
    // a second message is a new record: it is sent with the new id
    const freshId = hidden(container);
    choose("phone");
    await submit();
    expect(action.mock.calls[1][1].get("touch_id")).toBe(freshId);
    expect(action.mock.calls[1][1].get("touch_id")).not.toBe(ID_A);
    expect(hidden(container)).not.toBe(freshId); // and a third message would use yet another id
  });
});

describe("SentMessageForm: a refusal", () => {
  it("is shown as an alert, keeps what the person chose and keeps the SAME id (a retry replays)", async () => {
    const action = mk({ ok: false, error: "Your role cannot record that a message was sent." });
    const { container } = renderForm(action);
    choose("email");
    fireEvent.change(screen.getByLabelText(/When \(India time\)/), { target: { value: "2026-10-08T09:00" } });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot record that a message was sent.");
    expect(screen.getByLabelText("Channel")).toHaveValue("email");
    expect(screen.getByLabelText(/When \(India time\)/)).toHaveValue("2026-10-08T09:00");
    expect(hidden(container)).toBe(ID_A);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("a consent refusal points at the consent page of that person", async () => {
    renderForm(mk({ ok: false, reason: "consent", error: "There is no recorded consent for this channel, or this person has no number or e-mail for it. Record consent first, or check their details. Nothing was recorded." }));
    choose("whatsapp");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no recorded consent for this channel");
    expect(screen.getByRole("link", { name: "Record consent for this person →" })).toHaveAttribute("href", CONSENT);
  });
  it("a consent refusal without a known contact shows the sentence and no link", async () => {
    renderForm(mk({ ok: false, reason: "consent", error: "There is no recorded consent for this channel." }), ID_A, null);
    choose("whatsapp");
    await submit();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("any other refusal carries no consent link", async () => {
    renderForm(mk({ ok: false, error: "This person has asked not to be contacted, so a message to them cannot be recorded as sent." }));
    choose("whatsapp");
    await submit();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("SentMessageForm: one id per page render", () => {
  it("renders the page's id in the hidden field", () => {
    const { container } = renderForm(mk());
    expect(hidden(container)).toBe(ID_A);
  });
  it("new ids from the page restart the form: empty fields, the new id, no old result (rerender)", async () => {
    const action = mk({ ok: false, error: "Could not record this. Try again." });
    const { container, rerender } = renderForm(action);
    choose("phone");
    fireEvent.change(screen.getByLabelText(/When \(India time\)/), { target: { value: "2026-10-08T09:00" } });
    await submit();
    await screen.findByRole("alert");
    rerender(<SentMessageForm action={action} tenantId={T} touchId={ID_B} maxNow={MAX} contactId={CONTACT} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(hidden(container)).toBe(ID_B);
    expect(screen.getByLabelText("Channel")).toHaveValue("");
    expect(screen.getByLabelText(/When \(India time\)/)).toHaveValue("");
  });
  it("a re-render with the SAME id keeps what the person chose", async () => {
    const action = mk({ ok: false, error: "Could not record this. Try again." });
    const { container, rerender } = renderForm(action);
    choose("phone");
    await submit();
    await screen.findByRole("alert");
    rerender(<SentMessageForm action={action} tenantId={T} touchId={ID_A} maxNow={MAX} contactId={CONTACT} />);
    expect(screen.getByLabelText("Channel")).toHaveValue("phone");
    expect(hidden(container)).toBe(ID_A);
  });
});
