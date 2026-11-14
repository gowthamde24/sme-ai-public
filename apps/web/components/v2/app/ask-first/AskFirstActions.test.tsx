import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { AskConsentResult, AskOutcome } from "@/lib/api/ask-consent";

import { makeT } from "../words";
import { AskFirstActions } from "./AskFirstActions";

afterEach(cleanup);

const t = makeT(Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("dst.af."))));
const result = (over: Partial<AskConsentResult> = {}): AskConsentResult => ({ how: "whatsapp", asked: 12, queued: 9, blocked: 3, blockedReasons: { no_opt_in: 3 }, templateStatus: "none_registered", newAction: null, newTaskId: null, ...over });

describe("Ask first: the two ways to bring in the people whose consent is unknown", () => {
  it("'Ask by WhatsApp' says honestly it is not consent, how many could not be asked and why, and that no template is approved", async () => {
    const onAsk = vi.fn(async (): Promise<AskOutcome> => ({ ok: true, result: result() }));
    render(<AskFirstActions t={t} people={12} channel="call" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask by WhatsApp" }));
    await screen.findByText("Sent an OK request to 9 people. It is not consent until they agree.");
    expect(onAsk).toHaveBeenCalledWith("whatsapp");
    expect(document.querySelector('[data-part="ask-first-blocked"]')).toHaveTextContent("3 could not be asked: never wrote to you (3).");
    expect(screen.getByText(/templates are not approved yet/)).toBeInTheDocument();
  });

  it("'I confirm they agreed' asks the in-app sentence first (nothing is sent), only 'Yes, I confirm' records it; 'Back' goes back", async () => {
    const onAsk = vi.fn(async (): Promise<AskOutcome> => ({ ok: true, result: result({ how: "owner_confirms", queued: null, blocked: null, blockedReasons: {}, templateStatus: null, newAction: { type: "confirm_action" } }) }));
    const onDone = vi.fn();
    render(<AskFirstActions t={t} people={12} channel="call" onAsk={onAsk} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "I confirm they agreed" }));
    expect(screen.getByText("I confirm these 12 people agreed to be called. This is recorded.")).toBeInTheDocument();
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Ask by WhatsApp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I confirm they agreed" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, I confirm" }));
    await screen.findByText("Recorded. A new plan for 12 people is shown here, waiting for your yes.");
    expect(onAsk).toHaveBeenCalledWith("owner_confirms");
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ how: "owner_confirms" }));
  });

  it("a message plan says 'messages' in the confirmation; a refusal is one closed sentence, never the API's words", async () => {
    render(<AskFirstActions t={t} people={4} channel="whatsapp" onAsk={async () => ({ ok: false, error: "state" })} />);
    fireEvent.click(screen.getByRole("button", { name: "I confirm they agreed" }));
    expect(screen.getByText("I confirm these 4 people agreed to get messages. This is recorded.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, I confirm" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This plan has changed. Open it again."));
  });

  it("an ask that throws is 'that did not work', not silence", async () => {
    render(<AskFirstActions t={t} people={2} channel="call" onAsk={async () => { throw new Error("net"); }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask by WhatsApp" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That did not work. Try again."));
  });
});
