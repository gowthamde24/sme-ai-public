import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: nav.push }) }));
vi.mock("./Lazy", async () => ({ Conversation: (await import("./Conversation")).Conversation, QuoteOutcome: (await import("@/components/v2/app/ds/QuoteOutcome")).QuoteOutcome }));

import { wordsFor } from "@/i18n/app-words";
import { parseCustomerHead, parseTimeline } from "@/lib/api/customer-timeline";
import { parseConversationPage, parseThread } from "@/lib/api/whatsapp";

import { ChatList } from "./ChatList";
import { ChatsV6 } from "./ChatsV6";
import { Conversation, type ConversationProps } from "./Conversation";
import { CustomerCard } from "./CustomerCard";

/** Design system v6: the Chats page (the list with who handled each chat, the conversation with its glowing reply, the customer card). */
const W = wordsFor("en", ["chats6.", "wa.", "outbox.reason.", "outbox.flag.", "apierr.", "dst.teach", "calls6.quote.", "today.err.", "today.lang.", "catalogue.thumb.", "catalogue.photo.", "outcome.cat.", "ld.source."], ["dta.btn.working"]);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const L2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const L3 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const L4 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const M = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`;
const NOW = Date.parse("2026-11-13T06:00:00Z");
const conv = (lead: string, over: Record<string, unknown> = {}) => ({ lead_id: lead, name: "Ravi Kumar", company: null, last_at: "2026-11-13T04:00:00Z", last_direction: "in", preview: "Do you have red sarees?", window_open: true, window_expires_at: null, unread: false, stopped: false, ...over });
const CHATS = parseConversationPage({
  conversations: [
    conv(L1, { unread: true }),
    conv(L2, { name: "Asha Rao", last_direction: "out", preview: "Thank you, see you soon.", handled_by: "assistant" }),
    conv(L3, { name: "Meena", last_direction: "out", preview: "Visit booked for Saturday", handled_by: "owner", outcome: "visit_booked" }),
    conv(L4, { name: "Sunil", last_direction: "out", preview: "Here is the price list", stopped: true }),
  ],
  next_before: null,
}).conversations;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  nav.refresh.mockReset();
});

describe("the chat list", () => {
  const list = (over: Partial<React.ComponentProps<typeof ChatList>> = {}) => render(<ChatList words={W} base={BASE} filter="all" q="" chats={CHATS} waiting={new Set([L1])} selectedId={null} now={NOW} olderHref={null} {...over} />);
  it("each row says who handled it: Reply ready for you, Answered by assistant, the outcome, or Done", () => {
    list();
    const label = (l: string) => document.querySelector(`a[href="${BASE}/chats/${l}"] [data-part="handled-by"]`);
    expect(label(L1)).toHaveTextContent("Reply ready for you");
    expect(label(L2)).toHaveTextContent("Answered by assistant");
    expect(label(L3)).toHaveTextContent("Visit booked");
    expect(label(L4)).toHaveTextContent("Done");
    expect(document.querySelector(`a[href="${BASE}/chats/${L4}"]`)).toHaveTextContent("Asked us to stop");
  });
  it("a chat nobody has answered says Needs you", () => {
    list({ waiting: new Set() });
    expect(document.querySelector(`a[href="${BASE}/chats/${L1}"] [data-part="handled-by"]`)).toHaveTextContent("Needs you");
  });
  it("four filters with counts; 'Needs you' holds the waiting reply; the others hold their own", () => {
    list();
    const chips = [...document.querySelectorAll('[data-part="chat-filters"] a')];
    expect(chips.map((a) => a.textContent)).toEqual(["All4", "Needs you1", "By assistant1", "Done2"]);
    expect(chips[1]).toHaveAttribute("href", `${BASE}/chats?filter=needs_you`);
    cleanup();
    list({ filter: "needs_you" });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    cleanup();
    list({ filter: "done" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.querySelector('[data-filter="done"]')).toHaveAttribute("aria-current", "true");
  });
  it("the open chat is marked, its link keeps the filter, an unread dot shows, and the number is nowhere", () => {
    list({ selectedId: L2, filter: "assistant" });
    expect(document.querySelector(`a[href="${BASE}/chats/${L2}?filter=assistant"]`)).toHaveAttribute("aria-current", "true");
    cleanup();
    list();
    expect(screen.getByRole("img", { name: "New" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/\+91|wa\.me/);
  });
  it("says so when a filter shows nothing; 'Older' follows the cursor", () => {
    list({ chats: [], olderHref: `${BASE}/chats?before=x` });
    expect(document.querySelector('[data-part="chats-none"]')).toHaveTextContent("No chats here.");
    expect(screen.getByRole("link", { name: "Older chats" })).toHaveAttribute("href", `${BASE}/chats?before=x`);
  });
});

const THREAD = parseThread({
  lead_id: L1, name: "Ravi Kumar", display_name: "Ravi Kumar", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: null, next_before: null,
  items: [
    { direction: "out", id: M(3), at: "2026-11-13T03:30:00Z", text: "We have red Kanchi silk from ₹8,000.", status: "sent", delivery: "read", photos: 2 },
    { direction: "in", id: M(2), at: "2026-11-13T03:00:00Z", text: "Do you have red sarees?" },
    { direction: "out", id: M(1), at: "2026-11-13T02:50:00Z", text: "Namaste! How can we help?", status: "sent", delivery: "delivered", by: "owner" },
    { direction: "out", id: M(9), at: "2026-11-13T04:00:00Z", text: "A reply that waits.", status: "needs_approval", reason: "money" },
  ],
});
const decision = (message: string) => ({ ok: true as const, message });
const acts = (over: Partial<ConversationProps["actions"]> = {}): ConversationProps["actions"] => ({
  reply: vi.fn(async () => ({ ok: true as const, data: { status: "queued", reason: "" } })),
  markRead: vi.fn(async () => ({ ok: true as const, data: null })),
  approve: vi.fn(async () => decision("Sent.")),
  reject: vi.fn(async () => decision("Not sent.")),
  edit: vi.fn(async (_id: string, text: string) => ({ ok: true as const, message: "Words changed.", text })),
  setAssistant: vi.fn(async (on: boolean) => ({ ok: true as const, on })),
  ...over,
});
const teach = () => ({ save: vi.fn(async () => ({ ok: true as const, id: "55555555-5555-4555-8555-555555555555" })), undo: vi.fn(async () => ({ ok: true as const })) });
const WAITING = { id: M(9), text: "Yes, we have red Kanchi silk. Here are three designs.", language: "en", media: [{ position: 1, thumb_url: "https://img.example.test/a.jpg" }, { position: 2, thumb_url: null }], reasons: ["Money", "Promises"] };
const convo = (over: Partial<ConversationProps> = {}) => (
  <Conversation words={W} leadId={L1} name="Ravi Kumar" thread={THREAD} waiting={WAITING} canDecide canReply assistantOn switchState="free" teach={teach()} actions={acts()} backHref={`${BASE}/chats`} cardHref={`${BASE}/chats/${L1}?card=1`} customerHref={`${BASE}/customers/${L1}`} source="Instagram" now={NOW} {...over} />
);

describe("the conversation", () => {
  it("bubbles oldest first; the assistant's are marked 'sent by assistant', the owner's own and the customer's are not", () => {
    render(convo());
    const bubbles = [...document.querySelectorAll("li[data-direction]")];
    expect(bubbles.map((b) => b.getAttribute("data-by"))).toEqual(["owner", "customer", "assistant"]);
    expect(bubbles[0]).toHaveTextContent("Namaste! How can we help?");
    expect(bubbles[2]).toHaveTextContent("sent by assistant");
    expect(bubbles[2]).toHaveTextContent("Photos: 2");
    expect(bubbles[0]).not.toHaveTextContent("sent by assistant");
    expect(bubbles[1]).not.toHaveTextContent("sent by assistant");
    expect(screen.getByRole("heading", { level: 2, name: "Ravi Kumar" })).toBeInTheDocument();
  });
  it("Teach this is under every ASSISTANT bubble only (source chat), and saves that line", async () => {
    const t = teach();
    render(convo({ teach: t }));
    const bubbles = [...document.querySelectorAll("li[data-direction]")];
    expect(bubbles.map((b) => b.querySelectorAll('[data-part="teach"]').length)).toEqual([0, 0, 1]);
    fireEvent.click(within(bubbles[2] as HTMLElement).getByRole("button", { name: /Teach this/ }));
    fireEvent.change(within(bubbles[2] as HTMLElement).getByRole("textbox"), { target: { value: "Red Kanchi silk starts at ₹7,500." } });
    await act(async () => void fireEvent.click(within(bubbles[2] as HTMLElement).getByRole("button", { name: "Save to Knowledge" })));
    expect(t.save).toHaveBeenCalledWith({ source: "chat", sourceId: M(3), lineIndex: 2, answer: "Red Kanchi silk starts at ₹7,500." });
  });
  it("no Teach this when the person may not teach", () => {
    render(convo({ teach: null }));
    expect(document.querySelectorAll('[data-part="teach"]')).toHaveLength(0);
  });
  it("the waiting reply is a glowing card with its words, photos and the reasons, and is not also a bubble", () => {
    render(convo());
    const card = document.querySelector('[data-part="reply-ready"]') as HTMLElement;
    expect(card).toHaveClass("ds-glow");
    expect(card).toHaveTextContent("REPLY READY · WAITING FOR YOUR OK");
    expect(card).toHaveTextContent("Yes, we have red Kanchi silk. Here are three designs.");
    expect(card.querySelectorAll('[data-part="message-photos"] li')).toHaveLength(2);
    expect(card).toHaveTextContent("Waiting for you because: Money, Promises");
    expect(card).toHaveTextContent("Nothing goes to the customer until you press Send");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send", "Edit", "Write my own"]);
    expect(document.querySelectorAll("li[data-direction]")).toHaveLength(3);
  });
  it("Send is the existing approve; the page is read again; the answer is said", async () => {
    const a = acts();
    render(convo({ actions: a }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(a.approve).toHaveBeenCalledWith(M(9));
    expect(screen.getByRole("status")).toHaveTextContent("Sent.");
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("a refused send (no second factor, a stale card) is said in red and nothing is read again", async () => {
    const a = acts({ approve: vi.fn(async () => ({ ok: false as const, error: "Set up your authenticator app first.", mfa: true })) });
    render(convo({ actions: a }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Set up your authenticator app first.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });
  it("Edit changes the words of the waiting message (it stays waiting; nothing is sent)", async () => {
    const a = acts();
    render(convo({ actions: a }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Change the words"), { target: { value: "Yes, three designs below." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(a.edit).toHaveBeenCalledWith(M(9), "Yes, three designs below.");
    expect(a.approve).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="reply-ready"]')).toHaveTextContent("Yes, three designs below.");
    expect(screen.getByRole("status")).toHaveTextContent("Words changed.");
  });
  it("Edit can be cancelled and the words come back", () => {
    render(convo());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Change the words"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector('[data-part="reply-ready"]')).toHaveTextContent("Yes, we have red Kanchi silk.");
  });
  it("Write my own: your own reply goes through the outbox and then the assistant's draft is declined", async () => {
    const a = acts();
    render(convo({ actions: a }));
    fireEvent.click(screen.getByRole("button", { name: "Write my own" }));
    expect(screen.getByText(/the assistant's draft is dropped/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Type a message, or tell your assistant what to reply…"), { target: { value: " Come on Saturday please. " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(a.reply).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "Come on Saturday please.", "en");
    expect(a.reject).toHaveBeenCalledWith(M(9));
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("a plain reply does NOT decline the draft", async () => {
    const a = acts();
    render(convo({ actions: a }));
    fireEvent.change(screen.getByPlaceholderText("Type a message, or tell your assistant what to reply…"), { target: { value: "Hello" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(a.reply).toHaveBeenCalled();
    expect(a.reject).not.toHaveBeenCalled();
  });
  it("the composer: the placeholder, a mic, attach (a sample that says nothing is sent), a language, the rules line", () => {
    render(convo());
    expect(screen.getByPlaceholderText("Type a message, or tell your assistant what to reply…")).toBeInTheDocument();
    expect(document.querySelector('[data-part="composer"] input')).not.toBeNull(); // (DictInput: the field with its microphone inside)
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByRole("note")).toHaveTextContent("Attaching is a sample here: nothing is attached or sent.");
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.getByText(/follows the same rules as every message/)).toBeInTheDocument();
  });
  it("a refused reply is said with its reason and the words stay", async () => {
    const a = acts({ reply: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "Your role cannot send replies." })) });
    render(convo({ actions: a }));
    fireEvent.change(screen.getByPlaceholderText("Type a message, or tell your assistant what to reply…"), { target: { value: "Hello" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(screen.getByText("Your role cannot send replies.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type a message, or tell your assistant what to reply…")).toHaveValue("Hello");
  });
  it("Sales sees the waiting reply but cannot send it; Viewer-like people get no composer", () => {
    render(convo({ canDecide: false, canReply: true }));
    const card = document.querySelector('[data-part="reply-ready"]') as HTMLElement;
    expect(within(card).queryByRole("button")).toBeNull();
    expect(card).toHaveTextContent("Only the owner or an admin can send this.");
    cleanup();
    render(convo({ canDecide: false, canReply: false }));
    expect(document.querySelector('[data-part="composer"]')).toBeNull();
  });
  it("Assistant: on/off is a switch; flipping it asks the action and shows the note when off", async () => {
    const a = acts();
    render(convo({ actions: a }));
    const sw = screen.getByRole("switch", { name: "Assistant: on" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await act(async () => void fireEvent.click(sw));
    expect(a.setAssistant).toHaveBeenCalledWith(false);
    expect(screen.getByRole("switch", { name: "Assistant: off" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Your assistant will not answer this chat on its own. You reply yourself.")).toBeInTheDocument();
  });
  it("a switch that could not be saved goes back", async () => {
    const a = acts({ setAssistant: vi.fn(async () => ({ ok: false as const, error: "forbidden" })) });
    render(convo({ actions: a }));
    await act(async () => void fireEvent.click(screen.getByRole("switch")));
    expect(screen.getByRole("switch", { name: "Assistant: on" })).toBeInTheDocument();
  });
  it("the switch is locked for someone who may not flip it, and hidden where the flag is off", () => {
    render(convo({ switchState: "locked" }));
    expect(screen.getByRole("switch")).toBeDisabled();
    cleanup();
    render(convo({ switchState: "hidden" }));
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("a customer who said STOP is told so; a closed 24 hours too", () => {
    render(convo({ thread: { ...THREAD, stopped: true } }));
    expect(screen.getByRole("note")).toHaveTextContent("This customer asked us to stop.");
    cleanup();
    render(convo({ thread: { ...THREAD, window_open: false } }));
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
  it("marks the chat read when it opens and looks again every 20 seconds while in view", () => {
    vi.useFakeTimers();
    const a = acts();
    render(convo({ actions: a }));
    expect(a.markRead).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
  it("on a phone it has a way back to the list and to the customer card", () => {
    render(convo());
    expect(screen.getByRole("link", { name: "All chats" })).toHaveAttribute("href", `${BASE}/chats`);
    expect(document.querySelector('[data-part="chat-card-link"]')).toHaveAttribute("href", `${BASE}/chats/${L1}?card=1`);
  });
});

const HEAD = parseCustomerHead({ status: "new", display_name: "Ravi Kumar", source: "whatsapp", profile: { need: "Red Kanchi silk sarees", quantity: "20", budget: "₹8,000 each", timeline: "Wedding on 2 Dec", city: "Guntur" } });
const TL = parseTimeline({
  items: [
    { kind: "quote", at: "2026-11-13T05:00:00Z", text: "Quote 12", target: { type: "quote", id: "cccccccc-cccc-4ccc-8ccc-000000000001" }, detail: { status: "draft", total_paise: 16_000_000 } },
    { kind: "message_in", at: "2026-11-13T03:00:00Z", text: "Do you have red sarees?", target: { type: "enquiry", id: "x" }, detail: {} },
    { kind: "call", at: "2026-11-12T03:00:00Z", text: "Asked about red sarees", target: { type: "phone_call", id: "y" }, detail: {} },
  ],
});
describe("the customer card", () => {
  const card = (over: Partial<React.ComponentProps<typeof CustomerCard>> = {}) => render(<CustomerCard words={W} base={BASE} now={NOW} backHref={`${BASE}/chats/${L1}`} leadId={L1} name="Ravi Kumar" head={HEAD} timeline={TL.items} source="WhatsApp" approve={async () => decision("Approved.")} {...over} />);
  it("name, where from, interested in, how many, budget, event", () => {
    card();
    const c = document.querySelector('[data-chat="customer"]') as HTMLElement;
    expect(within(c).getByRole("heading", { level: 3, name: "Customer" })).toBeInTheDocument();
    for (const t of ["Name", "Ravi Kumar", "Came from", "WhatsApp", "Interested in", "Red Kanchi silk sarees", "How many", "20", "Budget", "₹8,000 each", "Event", "Wedding on 2 Dec"]) expect(c).toHaveTextContent(t);
    expect(within(c).getByRole("link", { name: /Open customer/ })).toHaveAttribute("href", `${BASE}/customers/${L1}`);
  });
  it("the open quote with Approve, and a history of the calls and messages", async () => {
    card();
    const q = document.querySelector('[data-part="chat-quote"]') as HTMLElement;
    expect(q).toHaveTextContent("₹1,60,000");
    expect(q).toHaveTextContent("Quote 12");
    await act(async () => void fireEvent.click(within(q).getByRole("button", { name: "Approve" })));
    expect(q).toHaveTextContent("Quote approved");
    const h = document.querySelector('[data-part="chat-history"]') as HTMLElement;
    expect(h.querySelectorAll("li")).toHaveLength(3);
    expect(h).toHaveTextContent("Call");
    expect(h).toHaveTextContent("Message from them");
    expect(h).toHaveTextContent("Asked about red sarees");
  });
  it("reads that failed say so in their place, and the rest still draws", () => {
    card({ head: null, timeline: null, source: null });
    expect(screen.getAllByText("Could not be read right now.").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("heading", { level: 3, name: "Customer" })).toBeInTheDocument();
  });
  it("no quote, no history: it says so; nothing known about what they want", () => {
    card({ head: parseCustomerHead({ status: "new", display_name: "Ravi", profile: null }), timeline: [], source: null });
    expect(screen.getByText("No quote yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is known about what they want yet.")).toBeInTheDocument();
  });
  it("Sales sees the quote but has no Approve", () => {
    card({ approve: null });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(document.querySelector('[data-part="chat-quote"]')).toHaveTextContent("₹1,60,000");
  });
});

describe("the Chats page", () => {
  const props = (over: Partial<React.ComponentProps<typeof ChatsV6>> = {}): React.ComponentProps<typeof ChatsV6> => ({
    words: W, lang: "en", base: BASE, filter: "all", q: "", chats: CHATS, waiting: new Set([L1]), now: NOW, olderHref: null, selectedId: null, card: false, conversation: null, customer: null, help: <i data-help />, connectHref: `${BASE}/integrations/whatsapp`, ...over,
  });
  const open = (): Partial<React.ComponentProps<typeof ChatsV6>> => ({
    selectedId: L1,
    conversation: { leadId: L1, name: "Ravi Kumar", thread: THREAD, waiting: WAITING, canDecide: true, canReply: true, assistantOn: true, switchState: "free", teach: null, actions: acts() },
    customer: { leadId: L1, name: "Ravi Kumar", head: HEAD, timeline: TL.items, source: "WhatsApp", approve: null },
  });
  it("three columns: the chats, a place to pick one, and (with a chat) the customer", () => {
    render(<ChatsV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Chats" })).toBeInTheDocument();
    expect(document.querySelector('[data-chats="list"]')).not.toBeNull();
    expect(document.querySelector('[data-part="chat-pick"]')).toHaveTextContent("Pick a chat to read it here.");
    expect(document.querySelector("[data-help]")).not.toBeNull();
    cleanup();
    render(<ChatsV6 {...props(open())} />);
    expect(document.querySelector('[data-chats="list"]')).not.toBeNull();
    expect(document.querySelector('[data-chat="conversation"]')).not.toBeNull();
    expect(document.querySelector('[data-chat="customer"]')).not.toBeNull();
  });
  it("on a phone one column shows at a time: the list, then the chat, then the customer card", () => {
    const col = (n: number) => (document.querySelector("main > div > div:nth-child(" + n + ")") as HTMLElement).className;
    render(<ChatsV6 {...props()} />);
    expect(col(1)).not.toContain("hidden");
    expect(col(2)).toMatch(/^hidden/);
    cleanup();
    render(<ChatsV6 {...props(open())} />);
    expect(col(1)).toMatch(/hidden lg:flex/);
    expect(col(2)).not.toMatch(/^hidden/);
    expect(col(3)).toMatch(/^hidden/);
    cleanup();
    render(<ChatsV6 {...props({ ...open(), card: true })} />);
    expect(col(2)).toMatch(/^hidden/);
    expect(col(3)).not.toMatch(/^hidden/);
  });
  it("no chats at all: the empty page shows its next step", () => {
    render(<ChatsV6 {...props({ chats: [] })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toHaveTextContent("No chats yet");
    expect(screen.getByRole("link", { name: "Connect WhatsApp" })).toHaveAttribute("href", `${BASE}/integrations/whatsapp`);
  });
  it("a list or a chat that could not be read says so", () => {
    render(<ChatsV6 {...props({ chats: null, selectedId: L1, conversation: null })} />);
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Your chats could not be read right now. Try again in a minute.", "This chat could not be read right now. Try again in a minute."]);
  });
});

void waitFor;
