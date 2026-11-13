import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { QuoteOutcome, type QuoteOut } from "./QuoteOutcome";

const W = appDict("en") as Record<string, string>;
const BASE = "/app/tenants/T";
const Q = "44444444-4444-4444-8444-444444444444";
const quote = (over: Partial<QuoteOut> = {}): QuoteOut => ({ quoteId: Q, type: "quote", state: "waiting", totalPaise: 2_450_000, ...over });
afterEach(cleanup);

describe("the quote a call or a chat left behind", () => {
  it("Calls: a 'Quote' label, the amount, Change and 'Approve & send'; approving opens WhatsApp through the quote's own route and says nothing was sent", async () => {
    const go = vi.fn();
    const approve = vi.fn(async () => ({ ok: true as const, message: "Approved. Nothing was sent. Open it in WhatsApp to send it yourself." }));
    render(<QuoteOutcome words={W} base={BASE} quote={quote()} approve={approve} go={go} />);
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.getByText("₹24,500")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute("href", `${BASE}/quotes/${Q}`);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve & send" })));
    expect(approve).toHaveBeenCalledWith(Q, "quote");
    expect(go).toHaveBeenCalledWith(`${BASE}/quotes/${Q}/whatsapp`);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent");
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", `${BASE}/quotes/${Q}/whatsapp`);
  });
  it("Chats: the amount, what it is for, and plain 'Approve' that does not leave the page", async () => {
    const go = vi.fn();
    render(<QuoteOutcome words={W} base={BASE} variant="chat" sub="2 sarees + blouses" quote={quote()} approve={async () => ({ ok: true as const, message: "Approved." })} go={go} />);
    expect(screen.getByText("2 sarees + blouses")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByText("Quote approved")).toBeInTheDocument();
  });
  it("a refused approval stays on the page and can be tried again; a building-materials quote never opens WhatsApp", async () => {
    const go = vi.fn();
    const approve = vi.fn(async () => ({ ok: false as const, error: "Set up your authenticator app first.", mfa: true }));
    render(<QuoteOutcome words={W} base={BASE} quote={quote({ type: "material_quote" })} approve={approve} go={go} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve & send" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Set up your authenticator app first.");
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve & send" })).toBeInTheDocument();
    cleanup();
    render(<QuoteOutcome words={W} base={BASE} quote={quote({ type: "material_quote", state: "approved" })} approve={approve} go={go} />);
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
  });
  it("without an amount it says what it is; approved quotes have no buttons but WhatsApp; no approve means none drawn", () => {
    render(<QuoteOutcome words={W} base={BASE} quote={quote({ totalPaise: null })} approve={null} />);
    expect(screen.getByText("Quote ready for your OK")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
