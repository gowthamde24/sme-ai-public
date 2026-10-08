import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConsentFormState } from "./actions";
import { ConsentForm } from "./consent-form";

const OK: ConsentFormState = { ok: true, channel: "whatsapp", status: "granted", by: "asha@example.test", at: "2026-10-08T10:30:00.000Z", consents: { whatsapp: "granted", phone: "unknown", email: "unknown" } };
const BUTTON = "Record this";
const BASIS = "Basis, as you describe it";
const KIND = "Kind of evidence";
const LABEL = "A short label for your note";

const radios = () => screen.getAllByRole("radio") as HTMLInputElement[];
const choose = (name: string) => fireEvent.click(screen.getByLabelText(name));
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: BUTTON })));

describe("ConsentForm: nothing is pre-selected", () => {
  it("on the first render no status is chosen, and the basis and evidence are not asked yet", () => {
    render(<ConsentForm action={vi.fn()} />);
    expect(radios()).toHaveLength(2);
    for (const r of radios()) expect(r.checked).toBe(false);
    expect(screen.queryByLabelText(BASIS)).toBeNull();
    expect(screen.queryByLabelText(KIND)).toBeNull();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });
  it("choosing Granted asks for the basis and the evidence, and they start with nothing chosen", () => {
    render(<ConsentForm action={vi.fn()} />);
    choose("Granted");
    expect(screen.getByLabelText(BASIS)).toHaveValue("");
    expect(screen.getByLabelText(KIND)).toHaveValue("");
    expect(screen.getByLabelText(LABEL)).toHaveValue("");
    const placeholders = screen.getAllByRole("option", { name: "Choose one", hidden: true }) as HTMLOptionElement[];
    expect(placeholders).toHaveLength(2); // one in the basis, one in the evidence kind
    for (const o of placeholders) expect(o.disabled).toBe(true);
  });
  it("choosing Withdrawn does not ask for a basis or evidence", () => {
    render(<ConsentForm action={vi.fn()} />);
    choose("Granted");
    choose("Withdrawn");
    expect(screen.queryByLabelText(BASIS)).toBeNull();
    expect(screen.queryByLabelText(KIND)).toBeNull();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });
  it("the three choices are required fields", () => {
    render(<ConsentForm action={vi.fn()} />);
    for (const r of radios()) expect(r).toBeRequired();
    choose("Granted");
    expect(screen.getByLabelText(BASIS)).toBeRequired();
    expect(screen.getByLabelText(KIND)).toBeRequired();
    expect(screen.getByLabelText(LABEL)).toBeRequired();
  });
});

describe("ConsentForm: each missing choice blocks the submit", () => {
  it("nothing chosen: the action is not called", async () => {
    const action = vi.fn(async () => OK);
    render(<ConsentForm action={action} />);
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("Granted only, no basis, no evidence, no label: not called", async () => {
    const action = vi.fn(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Granted");
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("Granted and a basis, no evidence kind: not called", async () => {
    const action = vi.fn(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Granted");
    pick(BASIS, "explicit_consent");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "call-1" } });
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("Granted and an evidence kind, no basis: not called", async () => {
    const action = vi.fn(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Granted");
    pick(KIND, "verbal");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "call-1" } });
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("Granted, a basis and a kind, but no label: not called", async () => {
    const action = vi.fn(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Granted");
    pick(BASIS, "explicit_consent");
    pick(KIND, "verbal");
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
  it("everything chosen: the action is called once with exactly what was chosen", async () => {
    const action = vi.fn<(prev: ConsentFormState, data: FormData) => Promise<ConsentFormState>>(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Granted");
    pick(BASIS, "contractual");
    pick(KIND, "written");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "msg-2026-10-08" } });
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect([data.get("channel"), data.get("status"), data.get("basis"), data.get("evidence_kind"), data.get("evidence_label")]).toEqual(["whatsapp", "granted", "contractual", "written", "msg-2026-10-08"]);
  });
  it("Withdrawn alone is enough: the action is called with no basis and no evidence", async () => {
    const action = vi.fn<(prev: ConsentFormState, data: FormData) => Promise<ConsentFormState>>(async () => OK);
    render(<ConsentForm action={action} />);
    choose("Withdrawn");
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][1];
    expect(data.get("status")).toBe("withdrawn");
    expect(data.get("basis")).toBeNull();
    expect(data.get("evidence_kind")).toBeNull();
  });
});

describe("ConsentForm: after a submit", () => {
  it("a blocked submit leaves nothing chosen", async () => {
    render(<ConsentForm action={vi.fn()} />);
    await submit();
    for (const r of radios()) expect(r.checked).toBe(false);
  });
  it("a failed submit keeps exactly what the person chose and chooses nothing else", async () => {
    const action = vi.fn(async () => ({ ok: false, error: "Your role cannot record consent." }) as ConsentFormState);
    render(<ConsentForm action={action} />);
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "phone" } });
    choose("Granted");
    pick(BASIS, "legitimate_use");
    pick(KIND, "email_reply");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "reply-1" } });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot record consent.");
    expect(screen.getByLabelText("Channel")).toHaveValue("phone");
    expect((screen.getByLabelText("Granted") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Withdrawn") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText(BASIS)).toHaveValue("legitimate_use");
    expect(screen.getByLabelText(KIND)).toHaveValue("email_reply");
    expect(screen.getByLabelText(LABEL)).toHaveValue("reply-1");
  });
  it("a failed submit after choosing only Withdrawn does not turn it into Granted or add a basis", async () => {
    const action = vi.fn(async () => ({ ok: false, error: "Could not record this. Try again." }) as ConsentFormState);
    render(<ConsentForm action={action} />);
    choose("Withdrawn");
    await submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect((screen.getByLabelText("Withdrawn") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Granted") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText(BASIS)).toBeNull();
  });
  it("a saved entry returns the form to nothing chosen, so a second press cannot repeat it", async () => {
    render(<ConsentForm action={vi.fn(async () => OK)} />);
    choose("Granted");
    pick(BASIS, "explicit_consent");
    pick(KIND, "verbal");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "call-1" } });
    await submit();
    await screen.findByRole("status");
    for (const r of radios()) expect(r.checked).toBe(false);
    expect(screen.queryByLabelText(BASIS)).toBeNull();
  });
});

describe("ConsentForm: wording and results", () => {
  it("offers the API's own words for the basis and no verdict word anywhere", () => {
    const { container } = render(<ConsentForm action={vi.fn()} />);
    choose("Granted");
    for (const word of ["Explicit consent", "Contractual", "Legitimate use", "Other"]) expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\b(valid|lawful|compliant|verified|approved)\b/i);
    expect(screen.getByText(/It does not check it, and it is not legal advice/)).toBeInTheDocument();
  });
  it("after a record it says who recorded it, when, and what is held now", async () => {
    render(<ConsentForm action={vi.fn(async () => OK)} />);
    choose("Granted");
    pick(BASIS, "explicit_consent");
    pick(KIND, "verbal");
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: "call-1" } });
    await submit();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recorded: WhatsApp, granted.");
    expect(status).toHaveTextContent("Recorded by asha@example.test at");
    expect(status).toHaveTextContent("(the time this screen sent it)");
    expect(status).toHaveTextContent("WhatsApp granted · Phone call nothing recorded · E-mail nothing recorded");
  });
  it("an error is an alert of our wording and no result is shown", async () => {
    render(<ConsentForm action={vi.fn(async () => ({ ok: false, error: "Your role cannot record consent." }) as ConsentFormState)} />);
    choose("Withdrawn");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot record consent.");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("the label field only takes the characters the API takes", () => {
    render(<ConsentForm action={vi.fn()} />);
    choose("Granted");
    const input = screen.getByLabelText(LABEL) as HTMLInputElement;
    expect(input.pattern).toBe("[A-Za-z0-9._#/\\-]{1,96}");
    expect(input).toBeRequired();
  });
});
