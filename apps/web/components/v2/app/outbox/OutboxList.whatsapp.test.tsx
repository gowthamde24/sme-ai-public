import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import type { OutboxMessage } from "@/lib/api/outbox";
import type { DecisionResult } from "../today/actions-types";
import { SENT_JSON } from "@/lib/api/outbox-fixtures";

import type { Role } from "../today/types";
import { OutboxList } from "./OutboxList";
import { BASE, NOW, WORDS, fakeOutboxActions, msg } from "./outbox-test-kit";

const ID = "11111111-aaaa-4aaa-8aaa-0000000000c1";
/** Approved by a person, not sent yet: queued with a decision. */
const APPROVED = (over: Record<string, unknown> = {}) => msg(SENT_JSON, { id: ID, status: "queued", reason: "owner_approved", decided_at: "2026-10-14T03:00:00Z", sent_at: null, scheduled_for: null, text: "Your visit is on Saturday at 11.", ...over });

function show(items: OutboxMessage[], { role = "owner" as Role, whatsappBase = BASE as string | null, markSent = vi.fn(async (): Promise<DecisionResult> => ({ ok: true, message: "Marked as sent by you." })) } = {}) {
  const actions = { ...fakeOutboxActions(), markSent };
  render(<OutboxList items={items} tab="scheduled" role={role} words={WORDS} lang="en" now={NOW} actions={actions} leadBase={`${BASE}/leads`} whatsappBase={whatsappBase} />);
  return markSent;
}
const openRow = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: /DEMO Lakshmi Textiles/ })));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Open in WhatsApp and I sent it (OUTBOX_WHATSAPP)", () => {
  it("an approved message that was not sent has a plain link to this site's own route, the honest line and 'I sent it'", async () => {
    show([APPROVED()]);
    await openRow();
    const link = screen.getByRole("link", { name: "Open in WhatsApp" });
    expect(link).toHaveAttribute("href", `${BASE}/outbox/${ID}/whatsapp`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Nothing is sent by this system/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I sent it" })).toBeInTheDocument();
  });

  it("holds no number and no wa.me address anywhere in the row", async () => {
    show([APPROVED()]);
    await openRow();
    expect(document.body.innerHTML).not.toMatch(/wa\.me|api\.whatsapp|tel:|\b\d{10}\b/);
  });

  it("'I sent it' calls the action with the message and takes the row off with the note", async () => {
    const markSent = show([APPROVED()]);
    await openRow();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I sent it" })));
    expect(markSent).toHaveBeenCalledWith(ID);
    expect(screen.getByText("Marked as sent by you.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
  });

  it("a refusal puts the row back with the reason", async () => {
    const markSent = vi.fn(async (): Promise<DecisionResult> => ({ ok: false, error: "This message is already marked as sent." }));
    show([APPROVED()], { markSent });
    await openRow();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I sent it" })));
    expect(screen.getByText("This message is already marked as sent.")).toBeInTheDocument();
  });

  it("words that do not fit in a link offer the chat alone and say why", async () => {
    show([APPROVED({ text: "₹".repeat(400) })]);
    await openRow();
    expect(screen.getByRole("link", { name: "Open the WhatsApp chat" })).toHaveAttribute("href", `${BASE}/outbox/${ID}/whatsapp?chat=1`);
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
    expect(screen.getByText(/too long to put in a link/)).toBeInTheDocument();
  });

  it.each([
    ["not approved yet", { status: "needs_approval", reason: "money", decided_at: null }],
    ["already sent", { status: "sent", sent_at: "2026-10-14T02:00:00Z" }],
    ["rejected", { status: "blocked", reason: "owner_rejected" }],
    ["sent by the system on its own", { status: "queued", reason: "auto_allowed", decided_at: null }],
  ])("a message that is %s has neither button", async (_n, over) => {
    show([APPROVED(over)]);
    await openRow();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "I sent it" })).toBeNull();
  });

  it("without the flag (no base), or for a Sales person, nothing is offered", async () => {
    show([APPROVED()], { whatsappBase: null });
    await openRow();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    cleanup();
    show([APPROVED()], { role: "sales" });
    await openRow();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });
});
