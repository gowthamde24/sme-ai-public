import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: nav.push }) }));
vi.mock("./LazyQueueComposer", async () => ({ QueueComposer: (await import("./QueueComposer")).QueueComposer }));

import { wordsFor } from "@/i18n/app-words";
import { parseQueuedMessage, type QueuedMessage, type QueueRefusal, type QueueResult } from "@/lib/api/chat-queue";
import { QUEUED_FIXTURES } from "@/lib/api/chat-queue.fixtures";
import { parseThread } from "@/lib/api/whatsapp";

import { Conversation, type ConversationProps } from "../Conversation";
import { POLL_MS, type QueueActions } from "./QueueComposer";
import { firstShown, isEnded, viewOf } from "./queue-model";

/** The Chats composer queue (owner, 19 Nov 2026): the box is always there; a closed 24 hours queues the message and the hello goes first. */
const W = wordsFor("en", ["chats6.", "wa.", "outbox.reason.", "outbox.flag.", "apierr.", "dst.teach", "calls6.quote.", "today.err.", "today.lang.", "catalogue.thumb.", "catalogue.photo.", "outcome.cat.", "ld.source."], ["dta.btn.working"]);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const M = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`;
const THREAD_OPEN = parseThread({ lead_id: L1, name: "Ravi Kumar", display_name: "Ravi Kumar", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: null, next_before: null, items: [{ direction: "in", id: M(2), at: "2026-11-13T03:00:00Z", text: "Do you have red sarees?" }] });
const THREAD = { ...THREAD_OPEN, window_open: false };
const Q = (k: keyof typeof QUEUED_FIXTURES, over: Record<string, unknown> = {}): QueuedMessage => parseQueuedMessage({ ...QUEUED_FIXTURES[k], ...over });
const HELP = "WhatsApp allows free messages for 24 hours after the customer's last message. We'll send a short hello first; your message goes as soon as they reply.";

const acts = () => ({
  reply: vi.fn(async () => ({ ok: true as const, data: { status: "queued", reason: "" } })),
  sendTemplate: vi.fn(async () => ({ ok: true as const, data: { status: "queued", reason: "" } })),
  markRead: vi.fn(async () => ({ ok: true as const, data: null })),
  approve: vi.fn(async () => ({ ok: true as const, message: "Sent." })),
  reject: vi.fn(async () => ({ ok: true as const, message: "Not sent." })),
  edit: vi.fn(async (_id: string, text: string) => ({ ok: true as const, message: "Words changed.", text })),
  setAssistant: vi.fn(async (on: boolean) => ({ ok: true as const, on })),
});
const ok = <T,>(data: T): QueueResult<T> => ({ ok: true, data });
const no = (refusal: QueueRefusal): QueueResult<never> => ({ ok: false, refusal });
const qa = (over: Partial<QueueActions> = {}): QueueActions => ({
  queue: vi.fn(async (_c: string, text: string) => ok(Q("waiting", { text }))),
  cancel: vi.fn(async (id: string) => ok({ id, status: "cancelled" as const })),
  poll: vi.fn(async () => ok<QueuedMessage | null | undefined>(null)),
  ...over,
});
const convo = (over: Partial<ConversationProps> = {}) => (
  <Conversation words={W} leadId={L1} name="Ravi Kumar" thread={THREAD} waiting={null} canDecide canReply assistantOn switchState="hidden" teach={null} actions={acts()} backHref={`${BASE}/chats`} cardHref={`${BASE}/chats/${L1}?card=1`} customerHref={`${BASE}/customers/${L1}`} source={null} now={Date.parse("2026-11-13T06:00:00Z")} queued={null} queue={qa()} {...over} />
);
const box = () => document.querySelector('[data-part="composer"] textarea') as HTMLTextAreaElement;
const status = () => document.querySelector('[data-part="queue-status"]') as HTMLElement;
const view = () => document.querySelector('[data-part="composer"]')?.getAttribute("data-view");
const typeIn = (v: string) => fireEvent.change(box(), { target: { value: v } });
const send = async () => act(async () => void fireEvent.click(document.querySelector('[data-part="queue-send"]') as HTMLElement));

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  nav.refresh.mockReset();
});

describe("the closed 24 hours: the box is always there", () => {
  it("shows the box, the help line EXACTLY, a Call instead button, and no template picker", () => {
    render(convo());
    expect(document.querySelectorAll('[data-part="composer"]')).toHaveLength(1); // the queue's box only, never also the old one
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(box()).toBeInTheDocument();
    expect(box()).not.toBeDisabled();
    expect(document.querySelector('[data-part="queue-help"]')).toHaveTextContent(HELP);
    expect(document.querySelector('[data-part="queue-help"]')!.textContent).toBe(HELP);
    expect(screen.queryByRole("heading", { name: "Pick an approved template" })).toBeNull();
    expect(document.querySelector('[data-part="window-note"]')).toBeNull(); // the old English note is gone: the help line says it
    expect(document.querySelector('[data-view="idle"]')).not.toBeNull();
  });
  it("typing and Send QUEUES the message: client_id is a uuid, the status shows at once (optimistic), the old send is not used", async () => {
    const a = acts();
    const q = qa();
    render(convo({ actions: a, queue: q }));
    typeIn("Yes, we have red Kanchi silk.");
    await send();
    expect(q.queue).toHaveBeenCalledTimes(1);
    const [clientId, text] = (q.queue as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(text).toBe("Yes, we have red Kanchi silk.");
    expect(a.reply).not.toHaveBeenCalled();
    expect(a.sendTemplate).not.toHaveBeenCalled();
    expect(view()).toBe("waiting");
    expect(status()).toHaveTextContent("Will send when they reply");
    expect(status()).toHaveTextContent("We sent Ravi a short hello. Your message goes as soon as they reply.");
    expect(box()).toHaveValue("Yes, we have red Kanchi silk."); // the words stay in the (now locked) box
    expect(box()).toBeDisabled();
  });
  it("the status shows BEFORE the API answers (optimistic)", async () => {
    let release!: (r: QueueResult<QueuedMessage>) => void;
    const q = qa({ queue: vi.fn(() => new Promise<QueueResult<QueuedMessage>>((r) => (release = r))) });
    render(convo({ queue: q }));
    typeIn("Hello");
    await send();
    expect(view()).toBe("waiting");
    await act(async () => release(ok(Q("waiting", { text: "Hello" }))));
    expect(view()).toBe("waiting");
  });
  it("an open window sends the normal way (the old composer, queue never called)", async () => {
    const a = acts();
    const q = qa();
    render(convo({ thread: THREAD_OPEN, actions: a, queue: q }));
    expect(document.querySelector('[data-part="composer"]')).not.toHaveAttribute("data-mode", "queue");
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Hi Ravi" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(a.reply).toHaveBeenCalledWith(expect.any(String), "Hi Ravi", "en");
    expect(q.queue).not.toHaveBeenCalled();
  });
  it("the flag off (nothing read) is the old behaviour: the template picker, no queue", () => {
    const TPL = [{ id: "77777777-7777-4777-8777-777777777771", name: "lead_ack", language: "en", purpose: "lead_ack", preview: "Hello Ravi, thank you.", variables: [] }];
    render(convo({ queued: undefined, queue: undefined, templates: TPL }));
    expect(screen.getByRole("heading", { name: "Pick an approved template" })).toBeInTheDocument();
    expect(document.querySelector('[data-mode="queue"]')).toBeNull();
    expect(document.querySelector('[data-part="window-note"]')).not.toBeNull();
  });
  it("a viewer (cannot reply) gets no composer at all", () => {
    render(convo({ canReply: false, canDecide: false }));
    expect(document.querySelector('[data-part="composer"]')).toBeNull();
  });
  it("Call instead is the normal call path: a link to the customer's page (where the call and its approval live)", () => {
    render(convo());
    const call = document.querySelector('[data-part="queue-call"]') as HTMLAnchorElement;
    expect(call).toHaveTextContent("Call instead");
    expect(call.getAttribute("href")).toBe(`${BASE}/customers/${L1}`);
  });
  it("Send is off for an empty box; the status area is always there (one reserved height)", () => {
    render(convo());
    expect(document.querySelector('[data-part="queue-send"]')).toBeDisabled();
    expect(status()).not.toBeNull();
  });
});

describe("cancel", () => {
  it("Cancel is quiet: the box is back with the words, the API cancel is a POST for that id", async () => {
    const q = qa();
    render(convo({ queued: Q("waiting"), queue: q }));
    expect(view()).toBe("waiting");
    await act(async () => void fireEvent.click(document.querySelector('[data-part="queue-cancel"]') as HTMLElement));
    expect(q.cancel).toHaveBeenCalledWith(QUEUED_FIXTURES.waiting.id);
    expect(view()).toBe("idle");
    expect(box()).toHaveValue(QUEUED_FIXTURES.waiting.text);
    expect(box()).not.toBeDisabled();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("if it already went (not_waiting) the screen goes back to what is true", async () => {
    const q = qa({ cancel: vi.fn(async () => no("not_waiting")), poll: vi.fn(async () => ok<QueuedMessage | null | undefined>(Q("sending"))) });
    render(convo({ queued: Q("waiting"), queue: q }));
    await act(async () => void fireEvent.click(document.querySelector('[data-part="queue-cancel"]') as HTMLElement));
    expect(view()).toBe("sending");
  });
});

describe("the states, from what the API says (polled every 5 seconds while the chat is open)", () => {
  it("waiting -> sending -> sent; the thread is read again when it went; the box is empty and a green 'Your message was sent' shows", async () => {
    vi.useFakeTimers();
    const answers: (QueuedMessage | null)[] = [Q("sending"), Q("sent")];
    const q = qa({ poll: vi.fn(async () => ok<QueuedMessage | null | undefined>(answers.shift() ?? Q("sent"))) });
    render(convo({ queued: Q("waiting"), queue: q }));
    expect(status()).toHaveTextContent("Will send when they reply");
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(view()).toBe("sending");
    expect(status()).toHaveTextContent("Sending…");
    expect(status()).toHaveTextContent("Ravi replied. Your message is going now.");
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(view()).toBe("sent");
    expect(status()).toHaveTextContent("Your message was sent");
    expect(box()).toHaveValue("");
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("night: the old 'replied_waiting_for_morning' word is shown as Sending… (a reply to the customer goes at once, day or night)", async () => {
    render(convo({ queued: Q("legacy_morning") }));
    expect(view()).toBe("sending");
    expect(status()).toHaveTextContent("Sending…");
    expect(document.body.textContent).not.toMatch(/9:00|9 am|morning/i);
  });
  it("it polls every 5 seconds, not while the page is hidden, and stops when the chat closes", async () => {
    vi.useFakeTimers();
    const q = qa();
    const { unmount } = render(convo({ queue: q }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 3)));
    expect(q.poll).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 3)));
    expect(q.poll).toHaveBeenCalledTimes(3);
    unmount();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS * 3)));
    expect(q.poll).toHaveBeenCalledTimes(3);
  });
  it("a read that fails keeps what is on the screen", async () => {
    vi.useFakeTimers();
    const q = qa({ poll: vi.fn(async () => no("down")) });
    render(convo({ queued: Q("waiting"), queue: q }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(view()).toBe("waiting");
  });
  it("failed: a plain sentence and Try again, which queues the same words again (a new client_id)", async () => {
    const q = qa();
    render(convo({ queued: Q("failed"), queue: q }));
    expect(view()).toBe("failed");
    expect(status()).toHaveTextContent("Not sent");
    expect(status()).toHaveTextContent("Your message did not go to Ravi. Nothing was sent.");
    expect(document.querySelector('[data-part="queue-call"]')).not.toBeNull();
    await act(async () => void fireEvent.click(document.querySelector('[data-part="queue-retry"]') as HTMLElement));
    expect(q.queue).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), QUEUED_FIXTURES.failed.text);
    expect(view()).toBe("waiting");
  });
  it("expired (7 days): 'They did not reply in 7 days. Your message was not sent.' with Call instead and Write again (the words come back to the box)", () => {
    render(convo({ queued: Q("expired") }));
    expect(view()).toBe("expired");
    expect(status()).toHaveTextContent("They did not reply in 7 days. Your message was not sent.");
    expect(document.querySelector('[data-part="queue-call"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-part="queue-write-again"]') as HTMLElement);
    expect(view()).toBe("idle");
    expect(box()).toHaveValue(QUEUED_FIXTURES.expired.text);
    expect(box()).not.toBeDisabled();
  });
  it("STOP seen by the poll (cancelled + stopped_by_customer): not sent, NO Call instead, a link to the Do Not Call explanation", async () => {
    vi.useFakeTimers();
    const q = qa({ poll: vi.fn(async () => ok<QueuedMessage | null | undefined>(Q("stopped"))) });
    render(convo({ queued: Q("waiting"), queue: q }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(view()).toBe("stopped");
    expect(status()).toHaveTextContent("They asked us to stop. Your message was not sent.");
    expect(document.querySelector('[data-part="queue-call"]')).toBeNull();
    expect(document.querySelector('[data-part="queue-dnc"]')).toHaveAttribute("href", `${BASE}/do-not-call`);
    expect(document.querySelector('[data-part="queue-send"]')).toBeDisabled();
  });
});

describe("refusals at the send (the words stay in the box; nothing is lost)", () => {
  const sendWith = async (queue: QueueActions["queue"], extra: Partial<QueueActions> = {}) => {
    const a = acts();
    render(convo({ actions: a, queue: qa({ queue, ...extra }) }));
    typeIn("Please keep 2 for me");
    await send();
    return a;
  };
  it("409 stopped_by_customer: said plainly, never queued, no call", async () => {
    await sendWith(vi.fn(async () => no("stopped_by_customer")));
    expect(view()).toBe("stopped");
    expect(status()).toHaveTextContent("They asked us to stop. Your message was not sent.");
    expect(box()).toHaveValue("Please keep 2 for me");
    expect(document.querySelector('[data-part="queue-call"]')).toBeNull();
  });
  it("409 consent_required: the hello cannot go, said at once, Call instead, the words stay", async () => {
    await sendWith(vi.fn(async () => no("consent_required")));
    expect(view()).toBe("hello");
    expect(status()).toHaveTextContent("We can't send the hello yet, so your message can't go. You can call instead.");
    expect(document.querySelector('[data-part="queue-send"]')).toBeDisabled(); // (Send is off: Call instead is the action)
    expect(document.querySelector('[data-part="queue-call"]')).not.toBeNull();
    expect(box()).toHaveValue("Please keep 2 for me");
    expect(box()).not.toBeDisabled();
  });
  it("continue_chat 'not_approved': the same at once, and the queued message is taken back (cancel)", async () => {
    const cancel = vi.fn(async (id: string) => ok({ id, status: "cancelled" as const }));
    await sendWith(vi.fn(async (_c: string, text: string) => ok(Q("hello_not_approved", { text }))), { cancel });
    expect(view()).toBe("hello");
    expect(status()).toHaveTextContent("We can't send the hello yet, so your message can't go. You can call instead.");
    expect(box()).toHaveValue("Please keep 2 for me");
    expect(cancel).toHaveBeenCalledWith(QUEUED_FIXTURES.hello_not_approved.id);
  });
  it("409 already_queued: the one that is there is shown", async () => {
    await sendWith(vi.fn(async () => no("already_queued")), { poll: vi.fn(async () => ok<QueuedMessage | null | undefined>(Q("waiting", { text: "Earlier words" }))) });
    expect(view()).toBe("waiting");
    expect(box()).toHaveValue("Earlier words");
  });
  it("409 window_open (it opened meanwhile): the message goes the normal way", async () => {
    const a = await sendWith(vi.fn(async () => no("window_open")));
    expect(a.reply).toHaveBeenCalledWith(expect.any(String), "Please keep 2 for me", "en");
    expect(view()).toBe("sent");
    expect(box()).toHaveValue("");
  });
  it.each([
    ["daily_limit" as const, "Today's limit of messages is reached. Try tomorrow, or call instead."],
    ["no_whatsapp" as const, "This customer has no WhatsApp number. You can call instead."],
    ["forbidden" as const, "Your role cannot send messages."],
    ["down" as const, "That did not work. Your words are still in the box. Try again."],
  ])("%s: one plain sentence, the words stay", async (refusal, sentence) => {
    await sendWith(vi.fn(async () => no(refusal)));
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(box()).toHaveValue("Please keep 2 for me");
    expect(view()).toBe("idle");
  });
});

describe("the model", () => {
  it("ended ones (sent, cancelled by the person) are not shown again after a reload; a STOP stays", () => {
    expect(isEnded(Q("sent"))).toBe(true);
    expect(isEnded(Q("cancelled"))).toBe(true);
    expect(isEnded(Q("stopped"))).toBe(false);
    expect(firstShown(Q("sent"))).toBeNull();
    expect(firstShown(Q("failed"))?.status).toBe("failed");
    expect(viewOf(Q("sent"), null)).toBe("idle");
    expect(viewOf(Q("sent"), "sent")).toBe("sent");
  });
});

describe("words: every sentence of this state is a key, in each language (no English note above a Telugu button)", () => {
  it("Telugu: the help line, the buttons and the status are all Telugu", () => {
    const te = wordsFor("te", ["chats6.", "wa.", "today.lang."], ["dta.btn.working"]);
    render(convo({ words: te }));
    expect(document.querySelector('[data-part="queue-help"]')!.textContent).toBe(te["chats6.q.help"]);
    expect(te["chats6.q.help"]).toMatch(/[ఀ-౿]/);
    expect(document.querySelector('[data-part="queue-call"]')!.textContent).toBe(te["chats6.q.call"]);
    expect(te["chats6.q.call"]).toMatch(/[ఀ-౿]/);
  });
  it("all the queue keys exist in te, hi and kn with the same {name} placeholder as English", async () => {
    const all = Object.keys(W).filter((k) => k.startsWith("chats6.q."));
    expect(all.length).toBeGreaterThanOrEqual(25);
    for (const lang of ["te", "hi", "kn"] as const) {
      const w = wordsFor(lang, ["chats6.q."]);
      for (const k of all) {
        expect(w[k], `${lang} ${k}`).toBeTruthy();
        expect(/\{name\}/.test(w[k]), `${lang} ${k} placeholder`).toBe(/\{name\}/.test(W[k]));
      }
    }
  });
});
