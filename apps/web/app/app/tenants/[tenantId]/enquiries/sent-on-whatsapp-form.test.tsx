import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SENT_AGAIN } from "@/lib/whatsapp/sentences";

import { SentOnWhatsappForm } from "./sent-on-whatsapp-form";
import type { SentMessageState } from "./sent-on-whatsapp-actions";

const T = "22222222-2222-2222-2222-222222222222";
const C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ID1 = "55555555-5555-4555-8555-555555555551";
const ID2 = "55555555-5555-4555-8555-555555555552";

function setup(action: (prev: SentMessageState, data: FormData) => Promise<SentMessageState>, contact: string | null = C, touchId = ID1) {
  return render(<SentOnWhatsappForm action={action} tenantId={T} touchId={touchId} consentContactId={contact} />);
}
const press = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: /I sent it on WhatsApp|Saving/ })); });
const sentId = (data: FormData) => data.get("touch_id");

describe("SentOnWhatsappForm", () => {
  it("is one button, the page's id in a hidden field, no channel, no time, no lead, and the sentence about a revised quote", () => {
    const { container } = setup(vi.fn(async () => undefined));
    expect(screen.getByRole("button", { name: "I sent it on WhatsApp" })).toBeInTheDocument();
    expect([...container.querySelectorAll("input, select, textarea")].map((e) => e.getAttribute("name"))).toEqual(["touch_id"]);
    expect(container.querySelector('input[name="touch_id"]')).toHaveValue(ID1);
    expect(screen.getByText(SENT_AGAIN)).toBeInTheDocument();
  });

  it("sends only the touch id; a success says what was recorded and takes a fresh id for the next press", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => ID2 });
    const action = vi.fn(async (_p: SentMessageState, _d: FormData): Promise<SentMessageState> => ({ ok: true, channel: "whatsapp", at: "2026-10-08T10:30:00.000Z" }));
    const { container } = setup(action);
    await press();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Recorded: you sent this quote on WhatsApp at"));
    expect(screen.getByRole("status")).toHaveTextContent("The follow-up list will show this lead when it is due.");
    expect([...(action.mock.calls[0][1] as FormData).keys()]).toEqual(["touch_id"]);
    expect(sentId(action.mock.calls[0][1])).toBe(ID1);
    expect(container.querySelector('input[name="touch_id"]')).toHaveValue(ID2);
    vi.unstubAllGlobals();
  });

  it("a refused press keeps the SAME id (a retry replays) and shows the plain sentence", async () => {
    const action = vi.fn(async (): Promise<SentMessageState> => ({ ok: false, error: "This lead has reached the limit of recorded touches." }));
    const { container } = setup(action);
    await press();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This lead has reached the limit of recorded touches."));
    expect(container.querySelector('input[name="touch_id"]')).toHaveValue(ID1);
    await press();
    expect(sentId((action.mock.calls as unknown as [SentMessageState, FormData][])[1][1])).toBe(ID1);
  });

  it("a consent refusal links to that person's consent page, built from ids", async () => {
    setup(vi.fn(async (): Promise<SentMessageState> => ({ ok: false, reason: "consent", error: "There is no recorded consent for this channel." })));
    await press();
    await waitFor(() => expect(screen.getByRole("link", { name: /Record consent for this person/ })).toHaveAttribute("href", `/app/tenants/${T}/contacts/${C}/consent`));
  });

  it("a consent refusal with no contact id shows the sentence and no link", async () => {
    setup(vi.fn(async (): Promise<SentMessageState> => ({ ok: false, reason: "consent", error: "There is no recorded consent for this channel." })), null);
    await press();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a new id from the page restarts the form and clears the old message", async () => {
    const action = vi.fn(async (): Promise<SentMessageState> => ({ ok: false, error: "x." }));
    const { rerender, container } = setup(action);
    await press();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    rerender(<SentOnWhatsappForm action={action} tenantId={T} touchId={ID2} consentContactId={C} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector('input[name="touch_id"]')).toHaveValue(ID2);
  });

  it("shows no phone number or address", () => {
    const { container } = setup(vi.fn(async () => undefined));
    expect(container.innerHTML).not.toMatch(/wa\.me|tel:|@/);
  });
});
