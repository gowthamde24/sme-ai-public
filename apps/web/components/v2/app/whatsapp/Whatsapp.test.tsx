import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { parseAccount, parseConversationPage, parseThread, type Thread } from "@/lib/api/whatsapp";

import { ChatList } from "./ChatList";
import { ChatThread } from "./ChatThread";
import { ConnectWhatsapp } from "./ConnectWhatsapp";
import { TemplatesList } from "./TemplatesList";
import { accountProblem, chronological, failureWord, outState } from "./wa-model";
import type { AccountActions, ChatActions } from "./wa-types";
import { makeT } from "../words";

const T = "11111111-1111-4111-8111-111111111111";
const L = "33333333-3333-4333-8333-333333333333";
const WORDS = wordsFor("en", ["wa.", "apierr.", "problem.", "outbox.reason.", "today.lang."], ["dta.btn.working"]);
const t = makeT(WORDS);
const NOW = Date.parse("2026-10-12T10:00:00Z");
const ACCOUNT = { configured: true, status: "active", waba_id: "123456789", phone_number_id: "987654321", display_phone: "+91 98765 43210", coexistence: false, token_ref: "SHOP_TOKEN", token_available: true, updated_at: "2026-10-12T09:00:00Z" };
const fail = (kind: string, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, kind: kind as never, error: "", ...(code ? { code } : {}), ...extra });
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Connect WhatsApp: the four states", () => {
  const acts = (over: Partial<AccountActions> = {}): AccountActions => ({
    save: vi.fn(async () => ({ ok: true as const, data: parseAccount({ ...ACCOUNT, status: "pending" }) })),
    activate: vi.fn(async () => ({ ok: true as const, data: parseAccount(ACCOUNT) })),
    disable: vi.fn(async () => ({ ok: true as const, data: parseAccount({ ...ACCOUNT, status: "disabled" }) })),
    ...over,
  });
  it.each([
    [{ configured: false, status: "none" }, "Not connected", "not_connected"],
    [{ ...ACCOUNT, status: "pending" }, "Connecting", "connecting"],
    [ACCOUNT, "Connected", "connected"],
    [{ ...ACCOUNT, status: "disabled" }, "Needs attention", "needs_attention"],
    [{ ...ACCOUNT, token_available: false }, "Needs attention", "needs_attention"],
  ])("%j is drawn as '%s'", (json, word, state) => {
    const { container } = render(<ConnectWhatsapp words={WORDS} account={parseAccount(json)} canEdit actions={acts()} />);
    expect(within(container.querySelector(`[data-wa-state="${state}"]`) as HTMLElement).getByText(word)).toBeInTheDocument();
  });
  it("says why it needs attention: switched off, or the server has no key of that name", () => {
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ ...ACCOUNT, status: "pending", token_available: false })} canEdit actions={acts()} />);
    expect(screen.getByText(/does not have the access key named SHOP_TOKEN/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch on" })).toBeDisabled(); // nothing to switch on without the key
  });
  it("says the number is connected, and that a test system never reaches customers", () => {
    render(<ConnectWhatsapp words={WORDS} account={parseAccount(ACCOUNT)} canEdit actions={acts()} />);
    expect(screen.getByText(/Your number \+91 98765 43210 is connected/)).toBeInTheDocument();
    expect(screen.getByText(/On a test or demo system, messages go to a stand-in/)).toBeInTheDocument();
  });
  it("saves the typed details (and only the NAME of the key), then shows the state the server reports", async () => {
    const a = acts();
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ configured: false, status: "none" })} canEdit actions={a} />);
    expect(screen.getByText(/never typed or shown here/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("WhatsApp Business account ID"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("Phone number ID"), { target: { value: "987654321" } });
    fireEvent.change(screen.getByLabelText("Name of the access key"), { target: { value: "SHOP_TOKEN" } });
    fireEvent.click(screen.getByLabelText("The same number is also used in the WhatsApp Business app"));
    await press("Save details");
    expect(a.save).toHaveBeenCalledWith({ wabaId: "123456789", phoneNumberId: "987654321", displayPhone: "", coexistence: true, tokenRef: "SHOP_TOKEN" });
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
  it("stops a bad id or key name before asking", async () => {
    const a = acts();
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ configured: false, status: "none" })} canEdit actions={a} />);
    fireEvent.change(screen.getByLabelText("WhatsApp Business account ID"), { target: { value: "abc" } });
    await press("Save details");
    expect(screen.getByRole("alert")).toHaveTextContent("The account ID is the digits");
    fireEvent.change(screen.getByLabelText("WhatsApp Business account ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Phone number ID"), { target: { value: "98765432" } });
    fireEvent.change(screen.getByLabelText("Name of the access key"), { target: { value: "bad name!" } });
    await press("Save details");
    expect(screen.getByRole("alert")).toHaveTextContent("letters, digits, _ and - only");
    expect(a.save).not.toHaveBeenCalled();
    expect(accountProblem({ wabaId: "1", phoneNumberId: "98765", tokenRef: "x" })).toBe("waba");
  });
  it("switches on and off, and shows what the server then says", async () => {
    const a = acts();
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ ...ACCOUNT, status: "pending" })} canEdit actions={a} />);
    await press("Switch on");
    expect(a.activate).toHaveBeenCalled();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    await press("Switch off");
    expect(a.disable).toHaveBeenCalled();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });
  it("Switch on and Switch off are different buttons, so the app-wide double-press guard never mistakes one for a repeat of the other", async () => {
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ ...ACCOUNT, status: "pending" })} canEdit actions={acts()} />);
    const on = screen.getByRole("button", { name: "Switch on" });
    await press("Switch on");
    expect(screen.getByRole("button", { name: "Switch off" })).not.toBe(on);
  });
  it.each([
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("forbidden"), /Your role cannot do this/],
    [fail("rate_limited", undefined, { retryAfter: 14 }), /Wait 14 seconds/],
    [fail("unavailable", "whatsapp_unavailable"), /WhatsApp is not available on this system/],
    [fail("invalid", "validation_error"), /One of the details is not valid/],
  ])("a refusal (%j) is said in words and keeps what was typed", async (reply, words) => {
    render(<ConnectWhatsapp words={WORDS} account={parseAccount({ ...ACCOUNT, status: "pending" })} canEdit actions={acts({ save: vi.fn(async () => reply) })} />);
    await press("Save details");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByLabelText("Phone number ID")).toHaveValue("987654321");
  });
  it("an admin reads the state but has no form and no switch", () => {
    render(<ConnectWhatsapp words={WORDS} account={parseAccount(ACCOUNT)} canEdit={false} actions={acts()} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch off" })).toBeNull();
    expect(screen.getByText("Only the owner can change the number's details.")).toBeInTheDocument();
  });
});

describe("the templates", () => {
  it("lists them with the language, what they are for and where they stand; an empty list says so", () => {
    render(<TemplatesList words={WORDS} items={[{ id: L, name: "shop_update", language: "te", purpose: "followup", status: "approved" }, { id: T, name: "visit_note", language: "en", purpose: "visit", status: "submitted" }]} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Telugu")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Approved")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Under review")).toBeInTheDocument();
    cleanup();
    render(<TemplatesList words={WORDS} items={[]} />);
    expect(screen.getByText("There are no templates yet.")).toBeInTheDocument();
  });
});

describe("the chat list", () => {
  const conv = (over: Record<string, unknown> = {}) => ({ lead_id: L, contact_id: "x", name: "Ravi Kumar", company: "WhatsApp customer 3fa9c1", phone: "+919876543210", last_at: "2026-10-12T08:00:00Z", last_direction: "in", preview: "Do you have red sarees?", last_inbound_at: "2026-10-12T08:00:00Z", window_open: true, window_expires_at: "2026-10-13T08:00:00Z", unread: true, stopped: false, ...over });
  it("shows each customer with the last words, how long ago, a dot when new, and a link to the chat; never the number", () => {
    render(<ChatList tenantId={T} words={WORDS} page={parseConversationPage({ conversations: [conv(), conv({ lead_id: "44444444-4444-4444-8444-444444444444", name: null, company: "Old Silks", unread: false, last_direction: "out", preview: "Thanks", window_open: false, stopped: true })], next_before: "2026-10-12T07:00:00Z" })} now={NOW} olderHref="/older" />);
    const first = screen.getAllByRole("link")[0];
    expect(first).toHaveAttribute("href", `/app/tenants/${T}/chats/${L}`);
    expect(within(first).getByText("Ravi Kumar")).toBeInTheDocument();
    expect(within(first).getByText("2h")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "New" })).toBeInTheDocument();
    const second = screen.getAllByRole("link")[1];
    expect(within(second).getByText("Old Silks")).toBeInTheDocument();
    expect(within(second).getByText(/^You: Thanks/)).toBeInTheDocument();
    expect(within(second).getByText("Asked us to stop")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Older chats" })).toHaveAttribute("href", "/older");
    expect(document.body.textContent).not.toContain("9876543210");
  });
  it("says a window that is over, and an empty inbox", () => {
    render(<ChatList tenantId={T} words={WORDS} page={parseConversationPage({ conversations: [conv({ window_open: false })], next_before: null })} now={NOW} olderHref={null} />);
    expect(screen.getByText("24 hours over")).toBeInTheDocument();
    cleanup();
    render(<ChatList tenantId={T} words={WORDS} page={{ conversations: [], next_before: null }} now={NOW} olderHref={null} />);
    expect(screen.getByRole("heading", { name: "No chats yet" })).toBeInTheDocument();
  });
  it("a customer's own words are drawn as text", () => {
    render(<ChatList tenantId={T} words={WORDS} page={parseConversationPage({ conversations: [conv({ preview: "<script>alert(1)</script>" })], next_before: null })} now={NOW} olderHref={null} />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});

describe("a chat", () => {
  const item = (over: Record<string, unknown>) => ({ direction: "out", id: "55555555-5555-4555-8555-555555555555", at: "2026-10-12T09:00:00Z", text: "Yes, we have red sarees.", status: "sent", reason: "auto_allowed", source: "owner", delivery: null, delivered_at: null, read_at: null, delivery_error: null, failure_code: null, photos: 0, ...over });
  const thread = (over: Record<string, unknown> = {}, items: Record<string, unknown>[] = []): Thread =>
    parseThread({ lead_id: L, contact_id: "x", name: "Ravi", phone: "+919876543210", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: "2026-10-13T09:00:00Z", next_before: null, items: [item({ id: "66666666-6666-4666-8666-666666666666", at: "2026-10-12T09:05:00Z", text: "Newest" }), item({ direction: "in", id: "77777777-7777-4777-8777-777777777777", at: "2026-10-12T09:00:00Z", text: "Oldest" }), ...items], ...over });
  const acts = (over: Partial<ChatActions> = {}): ChatActions => ({
    reply: vi.fn(async () => ({ ok: true as const, data: { status: "sent", reason: "auto_allowed" } })),
    approve: vi.fn(async () => ({ ok: true as const, data: { status: "queued", reason: "owner_approved" } })),
    reject: vi.fn(async () => ({ ok: true as const, data: { status: "blocked", reason: "owner_rejected" } })),
    refresh: vi.fn(async () => ({ ok: true as const, data: thread() })),
    markRead: vi.fn(async () => ({ ok: true as const, data: null })),
    ...over,
  });
  const view = (th: Thread, a: ChatActions, role = "owner", quiet: { start: number; end: number } | null = { start: 21, end: 9 }) => render(<ChatThread words={WORDS} thread={th} role={role} quiet={quiet} actions={a} now={NOW} />);

  it("shows the oldest message first, ours on the right with where it stands, theirs as text; the quiet-hours note", () => {
    view(thread({}, [item({ id: "88888888-8888-4888-8888-888888888888", at: "2026-10-12T09:02:00Z", text: "Read one", delivery: "read" })]), acts());
    const msgs = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(msgs[0]).toContain("Oldest");
    expect(msgs[msgs.length - 1]).toContain("Newest");
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Messages made between 9 pm and 9 am (India time) wait until the morning.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("9876543210");
  });
  it("marks the chat read when it opens", () => {
    const a = acts();
    view(thread(), a);
    expect(a.markRead).toHaveBeenCalledTimes(1);
  });
  it("a message waiting for the OK shows why, and the owner approves it (= send) or declines it", async () => {
    const waiting = item({ id: "99999999-9999-4999-8999-999999999999", at: "2026-10-12T09:10:00Z", text: "The price is 4,500.", status: "needs_approval", reason: "money" });
    const a = acts({ refresh: vi.fn(async () => ({ ok: true as const, data: thread({}, [waiting]) })) });
    view(thread({}, [waiting]), a);
    expect(screen.getByText("Waiting for OK")).toBeInTheDocument();
    expect(screen.getByText("Mentions a price")).toBeInTheDocument();
    await press("Approve and send");
    expect(a.approve).toHaveBeenCalledWith("99999999-9999-4999-8999-999999999999");
    expect(a.refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Queued. It will go soon.");
    await press("Do not send");
    expect(a.reject).toHaveBeenCalledWith("99999999-9999-4999-8999-999999999999");
    expect(screen.getByRole("status")).toHaveTextContent("Declined. It will not be sent.");
  });
  it("a salesperson sees the waiting message but has no approve or decline", () => {
    view(thread({}, [item({ id: "99999999-9999-4999-8999-999999999999", status: "needs_approval", reason: "money", at: "2026-10-12T09:10:00Z" })]), acts(), "sales");
    expect(screen.getByText("Waiting for OK")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeInTheDocument();
  });
  it("approving without the second step says so and keeps the message waiting", async () => {
    const a = acts({ approve: vi.fn(async () => fail("mfa", undefined, { mfa: true })) });
    view(thread({}, [item({ id: "99999999-9999-4999-8999-999999999999", status: "needs_approval", reason: "money", at: "2026-10-12T09:10:00Z" })]), a);
    await press("Approve and send");
    expect(screen.getByRole("alert")).toHaveTextContent(/second step/);
    expect(screen.getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByText("Waiting for OK")).toBeInTheDocument();
  });
  it("a blocked message says why in words; a failed delivery says what WhatsApp said", () => {
    view(thread({}, [item({ id: "a1111111-1111-4111-8111-111111111111", at: "2026-10-12T09:20:00Z", status: "blocked", reason: "no_opt_in", text: "Blocked one" }), item({ id: "a2222222-2222-4222-8222-222222222222", at: "2026-10-12T09:21:00Z", status: "sent", delivery: "failed", delivery_error: "unreachable", text: "Failed one" })]), acts());
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp could not reach this number.")).toBeInTheDocument();
  });
  it("sends a reply with a new id, the language and the text, then says what the rules did with it", async () => {
    const a = acts();
    view(thread(), a);
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Yes, we have." } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "te" } });
    await press("Send reply");
    expect(a.reply).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "Yes, we have.", "te");
    expect(screen.getByRole("status")).toHaveTextContent("Sent.");
    expect(screen.getByLabelText("Your message")).toHaveValue("");
  });
  it.each([
    [{ status: "queued", reason: "quiet_hours" }, /Held until the morning/],
    [{ status: "needs_approval", reason: "money" }, /Waiting for the owner's OK/],
    [{ status: "blocked", reason: "stopped" }, /Not sent: /],
  ])("a reply that comes to %j is said in words", async (data, words) => {
    view(thread(), acts({ reply: vi.fn(async () => ({ ok: true as const, data })) }));
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Hello" } });
    await press("Send reply");
    expect(screen.getByRole("status")).toHaveTextContent(words);
  });
  it("a refused reply keeps the text and says why", async () => {
    view(thread(), acts({ reply: vi.fn(async () => fail("forbidden")) }));
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Hello" } });
    await press("Send reply");
    expect(screen.getByRole("alert")).toHaveTextContent("Your role cannot do this");
    expect(screen.getByLabelText("Your message")).toHaveValue("Hello");
  });
  it("a customer who asked us to stop, or withdrew, or whose 24 hours are over, is told at the top", () => {
    view(thread({ stopped: true }), acts());
    expect(screen.getAllByRole("note")[0]).toHaveTextContent("asked us to stop");
    cleanup();
    view(thread({ whatsapp_consent: "withdrawn" }), acts());
    expect(screen.getByText(/withdrew their consent for WhatsApp/)).toBeInTheDocument();
    cleanup();
    view(thread({ window_open: false }), acts());
    expect(screen.getByText(/24 hours are over\. Only a message template/)).toBeInTheDocument();
    expect(screen.getByText(/a reply will fail unless an approved template fits/)).toBeInTheDocument();
  });
  it("looks again every twenty seconds while the tab is in front, and not while it is hidden", async () => {
    vi.useFakeTimers();
    const a = acts();
    view(thread(), a);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_100);
    });
    expect(a.refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_100);
    });
    expect(a.refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  it("a customer's message is drawn as text", () => {
    view(thread({}, [item({ direction: "in", id: "b1111111-1111-4111-8111-111111111111", at: "2026-10-12T09:30:00Z", text: "<b>x</b>" })]), acts());
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
  });
});

describe("the small rules", () => {
  it("the chat reads oldest first whatever order it came in", () => {
    expect(chronological([{ at: "2026-10-12T10:00:00Z" }, { at: "2026-10-12T09:00:00Z" }] as never).map((x) => x.at)).toEqual(["2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z"]);
  });
  it("where a message stands: the delivery report first, then the outbox state", () => {
    expect(outState({ status: "sent", delivery: "read" })).toBe("read");
    expect(outState({ status: "sent", delivery: "failed" })).toBe("failed");
    expect(outState({ status: "needs_approval", delivery: null })).toBe("waiting");
    expect(outState({ status: "queued", delivery: null })).toBe("queued");
    expect(outState({ status: "blocked", delivery: null })).toBe("blocked");
    expect(outState({ status: "sent", delivery: null })).toBe("sent");
  });
  it("a delivery or send failure has a sentence, and an unknown word has the generic one", () => {
    expect(failureWord({ delivery_error: "token_expired", failure_code: null }, t)).toMatch(/access key has expired/);
    expect(failureWord({ delivery_error: null, failure_code: "template_required" }, t)).toMatch(/approved message template/);
    expect(failureWord({ delivery_error: "something_new", failure_code: null }, t)).toBe("It did not go. The reason is not known.");
    expect(failureWord({ delivery_error: null, failure_code: null }, t)).toBeNull();
  });
});
