import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConsentAskPreview } from "@/lib/api/consent-ask";

import { ConsentAsk } from "./ConsentAsk";

afterEach(cleanup);

const words = { "consent.ask.button": "Ask for consent", "consent.ask.title": "This message would go to {customer}:", "consent.ask.how.message": "Normal message.", "consent.ask.how.template": "Approved template.", "consent.ask.hint": "Nothing is sent until you tap Send ask.", "consent.ask.send": "Send ask", "consent.ask.cancel": "Cancel", "consent.ask.sent": "Sent.", "consent.ask.reason.stopped": "They asked us to stop.", "consent.ask.reason.unknown": "Cannot ask now.", "consent.ask.err.template": "Template not approved.", "consent.ask.err.down": "Try again." };
const M = "33333333-3333-4333-8333-333333333333";
const p = (o: Partial<ConsentAskPreview> = {}): ConsentAskPreview => ({ leadId: "l", customer: "Kalyani", needed: true, reason: null, language: "te", text: "Hello, may we message you?", how: "message", windowOpen: true, messageId: M, ...o });

describe("Ask for consent on the customer page", () => {
  it("tapping it only previews: the exact words and how, nothing is sent", async () => {
    const send = vi.fn();
    render(<ConsentAsk words={words} preview={async () => ({ ok: true, preview: p() })} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for consent" }));
    expect(await screen.findByText("Hello, may we message you?")).toBeInTheDocument();
    expect(screen.getByText("This message would go to Kalyani:")).toBeInTheDocument();
    expect(screen.getByText("Nothing is sent until you tap Send ask.")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
  it("Send ask is the approval: it sends the preview's message id once", async () => {
    const send = vi.fn(async () => ({ ok: true as const, replayed: false }));
    render(<ConsentAsk words={words} preview={async () => ({ ok: true, preview: p({ how: "template" }) })} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for consent" }));
    expect(await screen.findByText("Approved template.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send ask" }));
    await waitFor(() => expect(screen.getByText("Sent.")).toBeInTheDocument());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(M);
  });
  it("Cancel sends nothing", async () => {
    const send = vi.fn();
    render(<ConsentAsk words={words} preview={async () => ({ ok: true, preview: p() })} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for consent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Ask for consent" })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
  it("a customer who cannot be asked gets a plain sentence and no Send button", async () => {
    render(<ConsentAsk words={words} preview={async () => ({ ok: true, preview: p({ needed: false, how: "none", reason: "stopped", text: null, messageId: null }) })} send={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for consent" }));
    expect(await screen.findByText("They asked us to stop.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send ask" })).toBeNull();
  });
  it("a refusal says nothing was sent in plain words", async () => {
    render(<ConsentAsk words={words} preview={async () => ({ ok: true, preview: p() })} send={async () => ({ ok: false, error: "template" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for consent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send ask" }));
    expect(await screen.findByText("Template not approved.")).toBeInTheDocument();
  });
});
