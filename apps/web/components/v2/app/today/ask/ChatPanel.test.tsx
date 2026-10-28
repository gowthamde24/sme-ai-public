import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import type { AskEvent } from "./ask-types";
import { blocksOf, MarkdownLite } from "./MarkdownLite";
import { ChatPanel } from "./ChatPanel";
import { useAskSession } from "./use-ask-session";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const voice = { words: WORDS, url: "wss://x/v1/tenants/t/voice-chat", language: "en" as const, languageNames: { te: CALL_LANG_NAMES.te, hi: CALL_LANG_NAMES.hi, kn: CALL_LANG_NAMES.kn, en: CALL_LANG_NAMES.en }, tokenUrl: "/app/tenants/t/voice-token" };

class Sock implements SocketLike {
  binaryType = "";
  readyState = 1;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  say(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  types() {
    return this.sent.map((x) => (typeof x === "string" ? (JSON.parse(x) as { type: string }).type : "audio"));
  }
}
let sock: Sock;
const audio = (): AudioIO => ({ startMic: async () => undefined, stopMic: () => undefined, play: () => undefined, flush: () => undefined, playing: () => false, close: () => undefined, analyser: () => null });
const asked: string[] = [];
const PLAN = { actionId: "33333333-3333-4333-8333-333333333333", title: "Call 12 new leads", summary: "Today, in calling hours.", steps: ["Pick the new leads", "Call each one"], count: 12, channel: "call" as const, estimate: { messages: 0, callMinutes: 30, costPaise: 0 }, needsSecondFactor: false, expiresAt: "2026-10-28T20:00:00Z", status: "proposed" as const };
async function* answer(text: string): AsyncGenerator<AskEvent> {
  if (text === "PLAN") {
    yield { type: "confirm_action", action: PLAN };
    yield { type: "done", conversationId: "55555555-5555-4555-8555-555555555555" };
    return;
  }
  if (text === "CLARIFY") {
    yield { type: "text", delta: "Which leads: today's or this week's?" };
    yield { type: "done", conversationId: "55555555-5555-4555-8555-555555555555" };
    return;
  }
  yield { type: "text", delta: text };
  yield { type: "done", conversationId: "55555555-5555-4555-8555-555555555555" };
}
const asks: { question: string; conversationId?: string | null }[] = [];
let sideCalls: Record<string, unknown>[] = [];
let sideAnswer: (body: Record<string, unknown>) => unknown = () => ({ ok: true });
let reply = "It is **five** pieces.\n- Silk\n- Cotton";
const orbs: (string | null)[] = [];

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const s = useAskSession({ lang: "en", base: "/app/tenants/t", words: {}, availability: "live", transport: ({ question, conversationId }) => (asked.push(question), asks.push({ question, conversationId }), answer(question === "PLAN" || question === "CLARIFY" ? question : reply)), voiceStatus: { available: false, speech: false } });
  React.useEffect(() => {
    orbs.push(s.voiceOrb);
  }, [s.voiceOrb]);
  return <ChatPanel session={s} chips={["Draft a follow-up for today's leads"]} voice={voice} onClose={onClose} voiceOptions={{ audioFactory: audio, socketFactory: () => (sock = new Sock()) }} />;
}
const draw = (props: { onClose?: () => void } = {}) => render(<Harness {...props} />);
const type = async (text: string) => {
  await act(async () => void fireEvent.change(screen.getByLabelText("Type, or tap the microphone"), { target: { value: text } }));
};
const send = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));

beforeEach(() => {
  asked.length = 0;
  orbs.length = 0;
  reply = "It is **five** pieces.\n- Silk\n- Cotton";
  asks.length = 0;
  sideCalls = [];
  sideAnswer = () => ({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/conversation")) {
        const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        sideCalls.push(body);
        return { ok: true, json: async () => sideAnswer(body) };
      }
      return { ok: true, json: async () => ({ token: "tok" }) };
    }),
  );
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the light formatting of an answer", () => {
  it("reads paragraphs, bullet and numbered lists, bold and code as elements, never as markup", () => {
    expect(blocksOf("Hello\n\n- a\n- b\n1. one\n2. two")).toEqual([{ kind: "p", lines: ["Hello"] }, { kind: "ul", items: ["a", "b"] }, { kind: "ol", items: ["one", "two"] }]);
    const { container } = render(<MarkdownLite text={"**bold** and `code`\n<script>alert(1)</script>"} />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("the conversation panel", () => {
  it("is a small chat: one line to write in, the microphone and a send button; no 'Ask' or 'Do it' button, no full-screen layer", () => {
    draw();
    expect(screen.getByRole("dialog", { name: "Your assistant" })).toHaveAttribute("aria-modal", "false");
    expect(screen.queryByRole("button", { name: /^(Ask|Do it)$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Talk" })).toBeInTheDocument();
    expect(screen.getByText(/Ask anything about your business, or just talk/)).toBeInTheDocument();
    expect(document.querySelector('[data-chat="panel"]')?.className).toMatch(/h-\[60dvh\]/);
  });
  it("a suggested prompt asks at once; the answer shows with its list and a copy button; New conversation empties the thread", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Draft a follow-up for today's leads" })));
    expect(asked).toEqual(["Draft a follow-up for today's leads"]);
    const thread = document.querySelector('[data-chat="thread"]') as HTMLElement;
    expect(within(thread).getByText("Draft a follow-up for today's leads")).toBeInTheDocument();
    expect(thread.querySelector("strong")?.textContent).toBe("five");
    expect(thread.querySelectorAll("li li")).toHaveLength(2);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("It is **five** pieces.\n- Silk\n- Cotton");
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent("Copied");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "New conversation" })));
    expect(document.querySelector('[data-chat="exchange"]')).toBeNull();
    expect(screen.getByText(/Ask anything about your business/)).toBeInTheDocument();
  });
  it("typed messages and spoken turns are ONE thread; the person's words show LIVE while they speak and the reply streams below", async () => {
    draw();
    await type("price of silk?");
    await send();
    expect(asked).toEqual(["price of silk?"]);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Talk" })));
    await act(async () => void sock.onopen?.());
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", access_token: "tok", language: "en" });
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(orbs.at(-1)).toBe("listen");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "how many en", final: false, spoken: true }));
    expect(screen.getByLabelText("Type, or tap the microphone")).toHaveValue("how many en"); // live, word by word
    expect(document.querySelector('[data-chat="you-live"]')).toHaveTextContent("how many en");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "how many enquiries today", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "thinking", step: "looking" }));
    expect(screen.getByText("Looking at your records…")).toBeInTheDocument();
    expect(orbs.at(-1)).toBe("think");
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Three today.", final: true, spoken: true }));
    expect(document.querySelector('[data-chat="assistant-live"]')).toHaveTextContent("Three today."); // the reply streams as text while it is spoken
    expect(orbs.at(-1)).toBe("speak");
    await act(async () => void sock.say({ type: "source", kind: "enquiry", label: "Enquiries today" }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    const you = [...document.querySelectorAll('[data-chat="you"]')].map((e) => e.textContent);
    expect(you[0]).toContain("price of silk?");
    expect(you[1]).toContain("how many enquiries today"); // the spoken turn is in the same thread, after the typed one
    expect(document.querySelector('[data-chat="live"]')).toBeNull();
    expect(screen.getByText("Enquiries today")).toBeInTheDocument();
  });
  it("a tap while it talks stops the speech (barge-in); the words heard can be edited if misheard; Escape ends the conversation and closes", async () => {
    const onClose = vi.fn();
    draw({ onClose });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Talk" })));
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop talking" })));
    expect(sock.types()).toContain("barge_in");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "pri silk", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Ok.", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Edit what I heard" })));
    expect(screen.getByLabelText("Type, or tap the microphone")).toHaveValue("pri silk");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(sock.types()).toContain("stop");
  });
  it("a plan from the assistant shows what it will do with ONE tap, Yes, do it / No; the answer goes to the API and the card then says what happened", async () => {
    draw();
    await type("PLAN");
    await send();
    const card = document.querySelector('[data-chat="plan"]') as HTMLElement;
    expect(card).toHaveTextContent("Call 12 new leads");
    expect(card).toHaveTextContent("12 people");
    expect(card).toHaveTextContent("about 30 call minutes");
    expect(card).toHaveTextContent("by phone call");
    expect(within(card).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Pick the new leads", "Call each one"]);
    sideAnswer = () => ({ ok: true, status: "confirmed" });
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "Yes, do it" })));
    expect(sideCalls[0]).toEqual({ op: "confirm", actionId: PLAN.actionId, decision: "yes" });
    expect(card).toHaveTextContent("Approved. It is being done.");
    expect(within(card).queryByRole("button", { name: "Yes, do it" })).toBeNull();
  });
  it("a refusal of the answer is said in words (the second factor, expired); No cancels", async () => {
    draw();
    await type("PLAN");
    await send();
    const card = document.querySelector('[data-chat="plan"]') as HTMLElement;
    sideAnswer = () => ({ ok: false, error: "mfa" });
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "Yes, do it" })));
    expect(within(card).getByRole("alert")).toHaveTextContent("two-step code");
    sideAnswer = () => ({ ok: true, status: "declined" });
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "No" })));
    expect(card).toHaveTextContent("Cancelled. Nothing was done.");
  });
  it("one short question from the assistant is shown as its message; the next message goes on in the same conversation, and New conversation starts another", async () => {
    draw();
    await type("CLARIFY");
    await send();
    expect(document.body).toHaveTextContent("Which leads: today's or this week's?");
    expect(asks[0].conversationId).toBeNull(); // the first message starts a conversation
    await type("today's");
    await send();
    expect(asks[1].conversationId).toBe("55555555-5555-4555-8555-555555555555"); // the answer continues it
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "New conversation" })));
    await type("another");
    await send();
    expect(asks[2].conversationId).toBeNull();
  });
  it("the history lists the earlier conversations, opens one into the thread (the next message continues it) and hides one", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    draw();
    sideAnswer = (b) => (b.op === "list" ? { items: [{ id, title: "Price of silk", updatedAt: "x", messageCount: 2, lastText: "Rs 500" }] } : b.op === "open" ? { id, messages: [{ role: "user", text: "price of silk?", kind: null, action: null, sources: [] }, { role: "assistant", text: "Rs 500 a piece.", kind: "answer", action: null, sources: [{ label: "Silk saree" }] }] } : { ok: true });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Earlier conversations" })));
    expect(await screen.findByText("Price of silk")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Price of silk/ })));
    expect(document.querySelector('[data-chat="thread"]')).toHaveTextContent("Rs 500 a piece.");
    expect(document.querySelector('[data-chat="thread"]')).toHaveTextContent("price of silk?");
    await type("and yesterday?");
    await send();
    expect(asks.at(-1)).toEqual({ question: "and yesterday?", conversationId: id });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Earlier conversations" })));
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Hide" })));
    expect(sideCalls.at(-1)).toEqual({ op: "archive", id });
    expect(screen.queryByText("Price of silk")).toBeNull();
  });
});
