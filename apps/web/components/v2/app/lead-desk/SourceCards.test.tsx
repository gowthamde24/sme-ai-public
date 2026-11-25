import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Card } from "@/lib/sources/types";

import type { CardsBody, CardsPost } from "./cards-post";
import { SourceCards } from "./SourceCards";

const base = { detail: null, received7d: 0, receivedTotal: 0, lastReceivedAt: null, problem: null, available: true, state: "off" as const, canTest: false, canDisconnect: false, testLabel: null, costPerLeadPaise: null, costSource: null };
const CARDS: Card[] = [
  { ...base, kind: "meta", status: "not_connected", headline: "Not connected", action: "oauth" },
  { ...base, state: "needs_attention", kind: "indiamart", status: "needs_attention", headline: "Needs attention", action: "paste_key", problem: { message: "IndiaMART key stopped working: paste a new one", fix: "paste_key" } },
  { ...base, kind: "email_forward", status: "not_connected", headline: "Not connected", action: "copy_address" },
  { ...base, state: "connected", kind: "website", status: "connected", headline: "Connected", detail: "12 leads this week", action: "copy_snippet", received7d: 12, receivedTotal: 40, lastReceivedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), canTest: true, canDisconnect: true, testLabel: "Send a test lead to your Leads", costSource: "website_form", costPerLeadPaise: 6000 },
  { ...base, state: "connected", kind: "files", status: "connected", headline: "Ready", action: "upload" },
  { ...base, state: "connected", kind: "whatsapp", status: "connected", headline: "Connected", action: "none" },
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

describe("Lead source cards: one heading, two clearly different Meta cards (owner, 17 Nov)", () => {
  it("keeps the section's own heading for screen readers only: the page's title and sub line are the visible ones", () => {
    show();
    const h = document.querySelector("#cards-h") as HTMLElement;
    expect(h.className).toContain("sr-only");
    expect(screen.queryByText(/One tap or two on each card/)).toBeNull();
  });
  it("tells an owner who pasted the old snippet to paste the new one (it has the consent tick), only on a website card that is on", () => {
    show();
    expect(within(card("website")).getByText(/Paste it again: the new one asks the customer to tick/)).toBeTruthy();
    expect(within(card("meta")).queryByText(/Paste it again/)).toBeNull();
  });
  it("names the lead form card and the click-to-WhatsApp card so they cannot be mistaken for each other", () => {
    show({ initial: [{ ...base, kind: "meta", status: "not_connected", headline: "Not connected", action: "oauth" }, { ...base, kind: "click_to_whatsapp", status: "not_connected", headline: "Not connected", action: "none" }] as Card[] });
    expect(within(card("meta")).getByRole("heading", { name: "Facebook and Instagram lead forms" })).toBeTruthy();
    expect(within(card("click_to_whatsapp")).getByRole("heading", { name: "Ads that open WhatsApp (Facebook and Instagram)" })).toBeTruthy();
  });
});

describe("Lead source cards", () => {
  it("shows one card per source with its status, what it does, and the API's own plain sentences", () => {
    show();
    expect(document.querySelectorAll("[data-card]")).toHaveLength(7);
    expect(within(card("website")).queryByText("12 leads this week")).toBeNull(); // said once, in the last-lead line
    expect(within(card("website")).getByText(/12 this week/)).toBeTruthy();
    expect(within(card("indiamart")).getByRole("alert").textContent).toBe("IndiaMART key stopped working: paste a new one");
    expect(within(card("indiamart")).getByRole("button", { name: "Fix it" })).toBeTruthy();
    expect(within(card("missed_calls")).getByText("Not switched on yet. Ask us to switch this on.")).toBeTruthy();
    expect(within(card("files")).getByRole("link", { name: "Add a file or list" }).getAttribute("href")).toBe("/app/tenants/T/import");
    expect(within(card("whatsapp")).queryByRole("button")).toBeNull();
  });
  it("every connected card says when its last lead came, and a card with none says so", () => {
    show();
    expect(within(card("website")).getByText("Last lead 3 h ago · 12 this week")).toBeTruthy();
    expect(within(card("whatsapp")).getByText("No lead yet")).toBeTruthy();
    expect(within(card("meta")).queryByText(/Last lead/)).toBeNull();
  });
  it("Test: asks the card's own test, shows the API's sentence, reads the cards again; a refusal is in plain words", async () => {
    reply = (b) => (b.op === "test" ? { ok: true, data: { result: "lead_created", message: "A test lead arrived in your Leads.", leadId: null, portal: null } } : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("website")).getByRole("button", { name: "Send a test lead to your Leads" }));
    expect(await within(card("website")).findByText("A test lead arrived in your Leads.")).toBeTruthy();
    expect(calls.map((c) => c.op)).toContain("cards");
    reply = (b) => (b.op === "test" ? { ok: false, error: "paused" } : { ok: true, data: CARDS });
    fireEvent.click(within(card("website")).getByRole("button", { name: "Send a test lead to your Leads" }));
    expect(await within(card("website")).findByText("This is paused. Turn it back on, then test.")).toBeTruthy();
  });
  it("What a lead costs: shown in rupees from the paise, saved as paise for the lead tag, and nothing is sent when it is empty or unchanged", async () => {
    show();
    const box = within(card("website")).getByLabelText("What one lead from here costs you (₹)") as HTMLInputElement;
    expect(box.value).toBe("60");
    const save = within(card("website")).getByRole("button", { name: "Save cost" });
    expect(save).toBeDisabled(); // unchanged
    fireEvent.change(box, { target: { value: "72.5" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls).toContainEqual({ op: "cost", source: "website_form", paise: 7250 }));
    expect(await within(card("website")).findByText("Saved.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "" } });
    expect(save).toBeDisabled();
    expect(within(card("meta")).queryByLabelText("What one lead from here costs you (₹)")).toBeNull(); // not connected, no tag
  });
  it("Disconnect asks once, says the leads stay, and only then disconnects", async () => {
    show();
    fireEvent.click(within(card("website")).getByRole("button", { name: "Disconnect" }));
    expect(within(card("website")).getByText(/Leads you already have stay/)).toBeTruthy();
    expect(calls.some((c) => c.op === "disconnect")).toBe(false);
    fireEvent.click(within(card("website")).getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(calls).toContainEqual({ op: "disconnect", card: "website" }));
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
    expect(((await screen.findByLabelText("Your lead e-mail address")) as HTMLInputElement).value).toBe("old@leads.test");
    expect(screen.getByText("Open Gmail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Make a new address/ }));
    await waitFor(() => expect((screen.getByLabelText("Your lead e-mail address") as HTMLInputElement).value).toBe("new@leads.test"));
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
  it("a paused card has one button that turns it back on, then the cards are read again", async () => {
    const paused = CARDS.map((c) => (c.kind === "website" ? { ...c, status: "needs_attention" as const, problem: { message: "This is paused, so no new leads come in.", fix: "resume" as const } } : c));
    reply = (b) => (b.op === "cards" ? { ok: true, data: CARDS } : { ok: true, data: null });
    show({ initial: paused });
    expect(within(card("website")).getByText("This is paused, so no new leads come in.")).toBeTruthy();
    fireEvent.click(within(card("website")).getByRole("button", { name: "Turn back on" }));
    await waitFor(() => expect(calls).toEqual([{ op: "resume", card: "website" }, { op: "cards" }]));
  });
  it("forwarded mails: the code Gmail sends to confirm forwarding is shown to copy", async () => {
    reply = (b) => (b.op === "email" ? { ok: true, data: { address: "a@leads.test", guide: [], portals: [], confirmation: { code: "987654321", receivedAt: null } } } : { ok: true, data: CARDS });
    show();
    fireEvent.click(within(card("email_forward")).getByRole("button", { name: "Get your address" }));
    expect(((await screen.findByLabelText("Gmail asks for this code to confirm forwarding")) as HTMLInputElement).value).toBe("987654321");
  });
  it("WhatsApp not connected points to Integrations", () => {
    show({ initial: CARDS.map((c) => (c.kind === "whatsapp" ? { ...c, status: "not_connected" as const } : c)) });
    expect((within(card("whatsapp")).getByRole("link", { name: "Open Integrations" }) as HTMLAnchorElement).getAttribute("href")).toBe("/app/tenants/T/integrations");
    expect(within(card("meta")).queryByRole("link")).toBeNull();
  });
  it("a card named in the address opens at once (the assistant's Connect my IndiaMART)", () => {
    show({ openCard: "indiamart" });
    expect(document.querySelector('[data-panel="indiamart"]')).not.toBeNull();
    expect(document.querySelector('[data-panel="email_forward"]')).toBeNull();
  });
  it("website off: one button turns it on; on: the snippet, the form link and the address for other tools; a new address asks once", async () => {
    const off = CARDS.map((c) => (c.kind === "website" ? { ...c, state: "off" as const, status: "not_connected" as const, canTest: false, canDisconnect: false } : c));
    reply = (b) => (b.op === "website" ? { ok: true, data: { snippet: "<form></form>", formLink: "https://x/f", webhookUrl: "https://x/hook" } } : { ok: true, data: off });
    const { unmount } = show({ initial: off });
    fireEvent.click(within(card("website")).getByRole("button", { name: "Get the snippet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn on the website form" }));
    await waitFor(() => expect(calls).toContainEqual({ op: "connect", card: "website" }));
    expect(calls.some((c) => c.op === "website")).toBe(false); // nothing to read before it is on
    unmount();
    show();
    fireEvent.click(within(card("website")).getByRole("button", { name: "Manage" }));
    expect(await screen.findByLabelText("Address for other tools (Zapier, Make, a form builder)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    expect(screen.getByText(/The old address stops working at once/)).toBeTruthy();
    expect(calls.some((c) => c.op === "rotate")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, make a new one" }));
    await waitFor(() => expect(calls).toContainEqual({ op: "rotate", card: "website" }));
    expect(await screen.findByText("New address made. Copy it again.")).toBeTruthy();
  });
  it("missed calls: off -> one button makes the address, shown ONCE with Copy and the steps; the address is gone once dismissed; a new one asks first", async () => {
    const mc = (state: "off" | "connected") => CARDS.map((c) => (c.kind === "missed_calls" ? { ...c, available: true, state, status: state === "off" ? ("not_connected" as const) : ("connected" as const), canTest: state === "connected", canDisconnect: state === "connected", costSource: "missed_calls" } : c));
    const info = { fields: [{ label: "Address for Missed calls", value: "https://api.example/v1/lead-intake/SECRET" }], steps: ["Open your phone company's settings.", "Paste this address there."] };
    reply = (b) => (b.op === "connect" || b.op === "rotate" ? { ok: true, data: info } : { ok: true, data: mc("connected") });
    const { unmount } = show({ initial: mc("off") });
    fireEvent.click(within(card("missed_calls")).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByLabelText("Address for Missed calls")).toHaveValue("https://api.example/v1/lead-intake/SECRET");
    expect(screen.getByText("Paste this address there.")).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByLabelText("Address for Missed calls")).toBeNull(); // not kept anywhere
    unmount();
    show({ initial: mc("connected") });
    fireEvent.click(within(card("missed_calls")).getByRole("button", { name: "Make a new address" }));
    expect(calls.some((c) => c.op === "rotate")).toBe(false); // asks first
    fireEvent.click(screen.getByRole("button", { name: "Yes, make a new one" }));
    expect(await screen.findByLabelText("Address for Missed calls")).toBeTruthy();
    expect(calls).toContainEqual({ op: "rotate", card: "missed_calls" });
  });
  it("IndiaMART check: says in this app's words that the key is accepted, is rate limited, or was refused", async () => {
    const im = CARDS.map((c) => (c.kind === "indiamart" ? { ...c, state: "connected" as const, status: "connected" as const, problem: null, canTest: true, canDisconnect: true, testLabel: "Check my IndiaMART key" } : c));
    const answer = (result: string) => (reply = (b) => (b.op === "test" ? { ok: true, data: { result, message: "", leadId: null, portal: null } } : { ok: true, data: im }));
    show({ initial: im });
    const go = () => fireEvent.click(within(card("indiamart")).getByRole("button", { name: "Check my IndiaMART key" }));
    answer("key_valid");
    go();
    expect(await within(card("indiamart")).findByText("IndiaMART accepted your key. Nothing was added to your Leads.")).toBeTruthy();
    answer("rate_limited");
    go();
    expect(await within(card("indiamart")).findByText(/only once in a few minutes/)).toBeTruthy();
    answer("key_rejected");
    go();
    expect(await within(card("indiamart")).findByText("That key did not work. Check it and paste it again.")).toBeTruthy();
  });
  it("e-mail parser: the address is shown ONCE; the test says which portal the parser read", async () => {
    const mail = (state: "off" | "connected") => CARDS.map((c) => (c.kind === "email_forward" ? { ...c, state, status: state === "off" ? ("not_connected" as const) : ("connected" as const), canTest: state === "connected", canDisconnect: state === "connected", testLabel: "Send a test e-mail lead", costSource: "email_forward" } : c));
    const info = { fields: [{ label: "Forward portal e-mails to", value: "leads+SECRET@in.example" }], steps: ["Open the portal's e-mail settings.", "Forward lead e-mails here."] };
    reply = (b) => (b.op === "connect" ? { ok: true, data: info } : { ok: true, data: mail("connected") });
    const { unmount } = show({ initial: mail("off") });
    fireEvent.click(within(card("email_forward")).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByLabelText("Forward portal e-mails to")).toHaveValue("leads+SECRET@in.example");
    expect(screen.getByText(/shown only now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByLabelText("Forward portal e-mails to")).toBeNull();
    expect(calls.some((c) => c.op === "email")).toBe(false); // the address is not read back any time
    unmount();
    reply = (b) => (b.op === "test" ? { ok: true, data: { result: "lead_created", message: "", leadId: "L1", portal: "JustDial" } } : { ok: true, data: mail("connected") });
    show({ initial: mail("connected") });
    fireEvent.click(within(card("email_forward")).getByRole("button", { name: "Send a test e-mail lead" }));
    expect(await within(card("email_forward")).findByText("The test e-mail was read as a JustDial lead. A test lead is in your Leads.")).toBeTruthy();
  });
  it("IndiaMART Pull now: only when connected; says what came; a slow down is in plain words", async () => {
    const im = CARDS.map((c) => (c.kind === "indiamart" ? { ...c, state: "connected" as const, status: "connected" as const, problem: null, canTest: true, canDisconnect: true, testLabel: "Check my IndiaMART key" } : c));
    show();
    expect(within(card("indiamart")).queryByRole("button", { name: "Pull now" })).toBeNull(); // needs attention: no pull
    cleanup();
    reply = (b) => (b.op === "pull" ? { ok: true, data: { fetched: 5, created: 3, merged: 1, invalid: 0, existing: 1, window_start: "a", window_end: "b" } } : { ok: true, data: im });
    show({ initial: im });
    fireEvent.click(within(card("indiamart")).getByRole("button", { name: "Pull now" }));
    expect(await within(card("indiamart")).findByText("Fetched 5: 3 new, 1 merged, 0 invalid, 1 already had.")).toBeTruthy();
    expect(calls.map((c) => c.op)).toContain("pull");
    reply = (b) => (b.op === "pull" ? { ok: false, error: "slow" } : { ok: true, data: im });
    fireEvent.click(within(card("indiamart")).getByRole("button", { name: "Pull now" }));
    expect(await within(card("indiamart")).findByText("IndiaMART lets you pull only once in a few minutes. Try again soon.")).toBeTruthy();
  });
  it("ads that open WhatsApp: off points to Integrations (nothing to test or disconnect); on shows the count and the cost box only", () => {
    const ad = (state: "off" | "connected") => CARDS.map((c) => (c.kind === "whatsapp" ? { ...c, kind: "click_to_whatsapp" as const, state, status: state === "off" ? ("not_connected" as const) : ("connected" as const), detail: state === "off" ? "Connect WhatsApp first: ads can only open a chat there." : null, received7d: 4, lastReceivedAt: new Date(Date.now() - 3600_000).toISOString(), costSource: "click_to_whatsapp" } : c));
    const { unmount } = show({ initial: ad("off") });
    expect(within(card("click_to_whatsapp")).getByText(/Connect WhatsApp first/)).toBeTruthy();
    expect(within(card("click_to_whatsapp")).getByRole("link", { name: "Open Integrations" })).toHaveAttribute("href", "/app/tenants/T/integrations");
    unmount();
    show({ initial: ad("connected") });
    expect(within(card("click_to_whatsapp")).getByText(/Last lead 1 h ago · 4 this week/)).toBeTruthy();
    expect(within(card("click_to_whatsapp")).queryByRole("button", { name: /Disconnect|test/i })).toBeNull();
    expect(within(card("click_to_whatsapp")).getByLabelText("What one lead from here costs you (₹)")).toBeTruthy();
  });
});

describe("the card words as codes (C1 #832)", () => {
  it("shows its own words for a code it knows, with the number, and the English for one it does not", async () => {
    const { refText, readCodes } = await import("@/lib/sources/codes");
    const words = { "scc.test.website": "మీ Leads కి test లీడ్ పంపండి", "scc.detail.leads_this_week": "ఈ వారం {n} లీడ్స్" };
    const codes = readCodes({ test_label: { code: "test.website", params: {} }, detail: { code: "detail.leads_this_week", params: { n: 3 } }, problem_message: { code: "problem.brand_new", params: {} } });
    expect(refText(words, codes.testLabel, "Send a test lead to your Leads")).toBe("మీ Leads కి test లీడ్ పంపండి");
    expect(refText(words, codes.detail, "3 leads this week")).toBe("ఈ వారం 3 లీడ్స్");
    expect(refText(words, codes.problemMessage, "Some new sentence")).toBe("Some new sentence"); // an unknown code: the API's English
    expect(refText(words, null, "No code")).toBe("No code");
    expect(readCodes(undefined)).toEqual({ detail: null, problemMessage: null, testLabel: null });
    expect(readCodes({ detail: { code: "Bad Code!", params: {} } }).detail).toBeNull();
  });
});
