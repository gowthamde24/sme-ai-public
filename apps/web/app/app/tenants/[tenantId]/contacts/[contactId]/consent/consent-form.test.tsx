import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConsentFormState } from "./actions";
import { ConsentForm } from "./consent-form";

const OK: ConsentFormState = { ok: true, channel: "whatsapp", status: "granted", by: "asha@example.test", at: "2026-10-08T10:30:00.000Z", consents: { whatsapp: "granted", phone: "unknown", email: "unknown" } };

async function press(state: ConsentFormState, fill = true) {
  const action = vi.fn(async () => state);
  render(<ConsentForm action={action} />);
  if (fill) fireEvent.change(screen.getByLabelText("A short label for your note"), { target: { value: "call-2026-10-08" } }); // the browser blocks a submit with a required field empty
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record this" })));
  return action;
}

describe("ConsentForm", () => {
  it("starts on Granted with the basis, the kind of evidence and the label; Withdrawn hides them", () => {
    render(<ConsentForm action={vi.fn()} />);
    expect(screen.getByLabelText("Basis, as you describe it")).toBeInTheDocument();
    expect(screen.getByLabelText("Kind of evidence")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Withdrawn"));
    expect(screen.queryByLabelText("Basis, as you describe it")).toBeNull();
    expect(screen.queryByLabelText("A short label for your note")).toBeNull();
  });
  it("offers the API's own words for the basis and no verdict word anywhere", () => {
    const { container } = render(<ConsentForm action={vi.fn()} />);
    for (const word of ["Explicit consent", "Contractual", "Legitimate use", "Other"]) expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\b(valid|lawful|compliant|verified|approved)\b/i);
    expect(screen.getByText(/It does not check it, and it is not legal advice/)).toBeInTheDocument();
  });
  it("after a record it says who recorded it, when, and what is held now", async () => {
    await press(OK);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recorded: WhatsApp, granted.");
    expect(status).toHaveTextContent("Recorded by asha@example.test at");
    expect(status).toHaveTextContent("(the time this screen sent it)");
    expect(status).toHaveTextContent("WhatsApp granted · Phone call nothing recorded · E-mail nothing recorded");
  });
  it("an error is an alert of our wording and no result is shown", async () => {
    await press({ ok: false, error: "Your role cannot record consent." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot record consent.");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("the label field only takes the characters the API takes", () => {
    render(<ConsentForm action={vi.fn()} />);
    const input = screen.getByLabelText("A short label for your note") as HTMLInputElement;
    expect(input.pattern).toBe("[A-Za-z0-9._#/\\-]{1,96}");
    expect(input).toBeRequired();
  });
});
