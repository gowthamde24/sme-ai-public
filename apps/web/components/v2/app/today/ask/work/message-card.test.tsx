import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport, type WorkTransport } from "@/lib/assistant-work/client";
import { parseWorkCard } from "@/lib/assistant-work/types";

import { makeT } from "../../../words";
import { WorkCards } from "./WorkCards";
import type { WorkEnv } from "./work-env";
import { createWorkStore } from "./work-store";

beforeAll(async () => void (await import("@/lib/assistant-work/fixture-transport")));
afterEach(cleanup);

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const BASE = "/app/tenants/c029cba3-d2f8-4923-8c5a-630852797fd3";
const M = "b4000000-0000-4000-8000-000000000001";
const json = (over: Record<string, unknown> = {}) => ({ kind: "message", id: "b4000000-0000-4000-8000-0000000000aa", message_id: M, recipient: { name: "Kalyani" }, text: "Hi Kalyani, how are you?", state: "queued", undo: { until: new Date(Date.now() + 30_000).toISOString() }, manual_reason: null, delivery: null, ...over });
function draw(card: unknown, transport: WorkTransport = fixtureTransport({ delay: 0 })) {
  const parsed = parseWorkCard(card, BASE);
  if (!parsed) throw new Error("does not parse");
  const env: WorkEnv = { t: makeT(WORDS), role: "owner", transport, store: createWorkStore(), onChange: () => undefined, base: BASE };
  return render(<WorkCards cards={[parsed]} env={env} />);
}
const line = () => document.querySelector('[data-work="message-line"]')?.textContent ?? "";

describe("the message card (the assistant sent it on the owner's own words)", () => {
  it("reads the contract's shape and nothing else", () => {
    expect(parseWorkCard(json(), BASE)).toMatchObject({ kind: "message", recipient: "Kalyani", state: "queued", messageId: M });
    expect(parseWorkCard(json({ state: "manual", message_id: null, manual_reason: "test_recipient_only", undo: null }), BASE)).toMatchObject({ state: "manual", messageId: null, manualReason: "test_recipient_only", undoUntil: null });
    expect(parseWorkCard(json({ state: "teleported" }), BASE)).toBeNull();
    expect(parseWorkCard(json({ recipient: {} }), BASE)).toBeNull();
    expect(parseWorkCard(json({ message_id: "nope" }), BASE)).toBeNull();
    expect(parseWorkCard(json({ state: "failed", undo: { until: new Date(Date.now() + 30_000).toISOString() } }), BASE)).toMatchObject({ undoUntil: null }); // a failed message has nothing to take back
  });

  it("while held: the words, who, the seconds left and Undo; it never says 'Sent' yet", () => {
    draw(json());
    expect(screen.getByLabelText("Message to Kalyani")).toBeTruthy();
    expect(document.querySelector('[data-work="message-text"]')?.textContent).toBe("Hi Kalyani, how are you?");
    expect(line()).toMatch(/^Sending to Kalyani in (29|30) s$/);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Sent to Kalyani");
  });

  it("Undo takes it back and says nothing was sent", async () => {
    draw(json());
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    await waitFor(() => expect(line()).toBe("Cancelled. Nothing was sent to Kalyani."));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo too late says it is already on its way", async () => {
    const real = fixtureTransport({ delay: 0 });
    draw(json(), { ...real, messageUndo: async () => ({ ok: false as const, error: "late" as const }) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("It is already on its way, so it cannot be taken back."));
  });

  it("after the hold the outbox is asked: sent, then delivered", async () => {
    draw(json({ undo: { until: new Date(Date.now() - 1000).toISOString() } }));
    expect(line()).toBe("On its way to Kalyani");
    await waitFor(() => expect(line()).toContain("Sent to Kalyani"), { timeout: 4000 });
  });

  it("a message with no hold that is already sent says so", () => {
    draw(json({ state: "sent", undo: null, delivery: "delivered" }));
    expect(line()).toBe("Sent to KalyaniDelivered");
  });

  it("failed says so in red words, with no Undo", () => {
    draw(json({ state: "failed", undo: null }));
    expect(line()).toBe("It could not be sent to Kalyani.");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("manual (outside the WhatsApp test fence): nothing was sent, said in one line; 'Open in your WhatsApp' only when there is an approved copy, through the outbox redirect (no number here)", () => {
    const { unmount } = draw(json({ state: "manual", manual_reason: "test_recipient_only", undo: null, message_id: null }));
    expect(line()).toBe("WhatsApp can only reach your test numbers right now, so nothing was sent.");
    expect(document.querySelector('[data-work="message-open"]')).toBeNull();
    unmount();
    draw(json({ state: "manual", manual_reason: "test_recipient_only", undo: null }));
    expect(document.querySelector('[data-work="message-open"]')?.getAttribute("href")).toBe(`${BASE}/outbox/${M}/whatsapp`);
    expect(document.body.textContent).not.toMatch(/\+?\d{10}/);
  });
});
