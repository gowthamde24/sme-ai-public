import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Card } from "@/lib/sources/types";

import type { CardsBody, CardsPost } from "./cards-post";
import { SourceCards } from "./SourceCards";

const base = { detail: null, received7d: 0, lastReceivedAt: null, problem: null, available: true };
const CARDS: Card[] = [
  { ...base, kind: "meta", status: "not_connected", headline: "Not connected", action: "oauth" },
  { ...base, kind: "indiamart", status: "needs_attention", headline: "Needs attention", action: "paste_key", problem: { message: "IndiaMART key stopped working: paste a new one", fix: "paste_key" } },
  { ...base, kind: "email_forward", status: "not_connected", headline: "Not connected", action: "copy_address" },
  { ...base, kind: "website", status: "connected", headline: "Connected", detail: "12 leads this week", action: "copy_snippet" },
  { ...base, kind: "files", status: "connected", headline: "Ready", action: "upload" },
  { ...base, kind: "whatsapp", status: "connected", headline: "Connected", action: "none" },
  { ...base, kind: "missed_calls", status: "coming_soon", headline: "Coming soon", action: "none", available: false },
];
let calls: CardsBody[];
let reply: (b: CardsBody) => unknown;
const post = (async (b: CardsBody) => {
  calls.push(b);
  return reply(b);
}) as unknown as CardsPost;
const show = (over: Partial<Parameters<typeof SourceCards>[0]> = {}) => render(<SourceCards initial={CARDS} endpoint="/e" base="/app/tenants/T" metaReturn={false} post={post} {...over} />);
const card = (kind: string) => document.querySelector(`[data-card="${kind}"]`) as HTMLElement;

beforeEach(() => {
  calls = [];
  reply = (b) => (b.op === "cards" ? { ok: true, data: CARDS } : { ok: true, data: null });
});
afterEach(cleanup);

describe("Lead source cards", () => {
  it("shows one card per source with its status, what it does, and the API's own plain sentences", () => {
    show();
    expect(document.querySelectorAll("[data-card]")).toHaveLength(7);
    expect(within(card("website")).getByText("Connected · 12 leads this week")).toBeTruthy();
    expect(within(card("indiamart")).getByRole("alert").textContent).toBe("IndiaMART key stopped working: paste a new one");
    expect(within(card("indiamart")).getByRole("button", { name: "Fix it" })).toBeTruthy();
    expect(within(card("missed_calls")).getByText("Not switched on yet. Ask us to switch this on.")).toBeTruthy();
    expect(within(card("files")).getByRole("link", { name: "Add a file or list" }).getAttribute("href")).toBe("/app/tenants/T/import");
    expect(within(card("whatsapp")).queryByRole("button")).toBeNull();
  });
  it("Facebook: one button asks for the secure address and goes there", async () => {
    const go = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: go });
    reply = (b) => (b.op === "meta_connect" ? { ok: true, data: "https://www.facebook.com/dialog/oauth?x=1" } : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Facebook" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("https://www.facebook.com/dialog/oauth?x=1"));
    vi.unstubAllGlobals();
  });
  it("IndiaMART: the key is a password box, is sent once, the box empties, and only the hint is shown; a refusal is in plain words", async () => {
    reply = (b) => (b.op === "indiamart_key" ? (b.key === "bad-key-1" ? { ok: false, error: "badkey" } : { ok: true, data: { status: "connected", hint: "...a1b2" } }) : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("indiamart")).getByRole("button", { name: "Fix it" }));
    const box = screen.getByLabelText("Your IndiaMART CRM key") as HTMLInputElement;
    expect(box.type).toBe("password");
    fireEvent.change(box, { target: { value: "bad-key-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.getByText("That key did not work. Check it and paste it again.")).toBeTruthy());
    fireEvent.change(box, { target: { value: "good-key-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("Connected. Key saved (...a1b2).")).toBeTruthy();
    expect(box.value).toBe("");
    expect(calls.filter((c) => c.op === "cards").length).toBeGreaterThan(0); // the card is read again
  });
  it("forwarded mails: the address and the Gmail steps appear when the card opens, and a new address can be made", async () => {
    reply = (b) => (b.op === "email" ? { ok: true, data: { address: b.rotate ? "new@leads.test" : "old@leads.test", guide: [{ step: 1, text: "Open Gmail" }], portals: [] } } : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("email_forward")).getByRole("button", { name: "Get your address" }));
    expect(((await screen.findByLabelText("Your forwarding address")) as HTMLInputElement).value).toBe("old@leads.test");
    expect(screen.getByText("Open Gmail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Make a new address/ }));
    await waitFor(() => expect((screen.getByLabelText("Your forwarding address") as HTMLInputElement).value).toBe("new@leads.test"));
  });
  it("website: the snippet and the ready form link", async () => {
    reply = (b) => (b.op === "website" ? { ok: true, data: { snippet: "<script src=x></script>", formLink: "https://f.test/1" } } : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("website")).getByRole("button", { name: "Manage" }));
    expect(((await screen.findByLabelText("Website snippet")) as HTMLTextAreaElement).value).toBe("<script src=x></script>");
    expect((screen.getByLabelText("Ready form link") as HTMLInputElement).value).toBe("https://f.test/1");
  });
  it("coming back from Facebook opens its card, lists the Pages and chooses one", async () => {
    const connected = CARDS.map((c) => (c.kind === "meta" ? { ...c, status: "connected" as const } : c));
    reply = (b) => (b.op === "meta_pages" ? { ok: true, data: [{ id: "p1", name: "Sri Traders", selected: false }, { id: "p2", name: "Offers", selected: false }] } : { ok: true, data: connected });
    show({ initial: connected, metaReturn: true });
    expect(await screen.findByText("Sri Traders")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Use this Page" })[0]);
    await waitFor(() => expect(calls).toContainEqual({ op: "meta_select", pageId: "p1" }));
    expect(await screen.findByText(/Sri Traders · in use/)).toBeTruthy();
  });
});
