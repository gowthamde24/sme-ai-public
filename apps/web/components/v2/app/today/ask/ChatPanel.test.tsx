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
let voiceOverride: Record<string, unknown> = {};
const voiceBase = { words: WORDS, url: "wss://x/v1/tenants/t/voice-chat", language: "en" as const, languageNames: CALL_LANG_NAMES, tokenUrl: "/app/tenants/t/voice-token" };

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
const asks: { question: string; conversationId?: string | null; replyLanguage?: string | null }[] = [];
let sideCalls: Record<string, unknown>[] = [];
let sideAnswer: (body: Record<string, unknown>) => unknown = () => ({ ok: true });
let reply = "It is **five** pieces.\n- Silk\n- Cotton";
const orbs: (string | null)[] = [];

function Harness({ onClose = () => undefined, variant }: { onClose?: () => void; variant?: "panel" | "card" | "bar" }) {
  const s = useAskSession({ lang: "en", base: "/app/tenants/t", words: {}, availability: "live", transport: ({ question, conversationId, replyLanguage }) => (asked.push(question), asks.push({ question, conversationId, replyLanguage }), answer(question === "PLAN" || question === "CLARIFY" ? question : reply)), voiceStatus: { available: false, speech: false } });
  React.useEffect(() => {
    orbs.push(s.voiceOrb);
  }, [s.voiceOrb]);
  return <ChatPanel session={s} chips={["Draft a follow-up for today's leads"]} voice={{ ...voiceBase, ...voiceOverride }} variant={variant} onClose={onClose} voiceOptions={{ audioFactory: audio, socketFactory: () => (sock = new Sock()) }} />;
}
const draw = (props: { onClose?: () => void; variant?: "panel" | "card" | "bar" } = {}) => render(<Harness {...props} />);
const type = async (text: string) => {
  await act(async () => void fireEvent.change(screen.getByLabelText("Type, dictate, or go Live"), { target: { value: text } }));
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

describe("the input bar: Dictate and Live talk (owner, 30 Oct)", () => {
  const open = async (name: RegExp) => {
    await act(async () => void fireEvent.click(screen.getByRole("button", { name })));
    await act(async () => void sock.onopen?.());
  };
  it("is a composer card (the text on top, the toolbar under it: plus, language pill, spacer, Dictate, Send); the orb at the top of the panel is the Talk button", () => {
    draw();
    const form = document.querySelector('[data-chat="form"]') as HTMLElement;
    expect(form.className).toContain("rounded-[16px]");
    const text = form.querySelector("textarea") as HTMLElement;
    const toolbar = form.querySelector('[data-chat="toolbar"]') as HTMLElement;
    expect(text.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the toolbar is BELOW the text
    expect([...toolbar.querySelectorAll("select, button")].map((e) => (e.tagName === "SELECT" ? "pill" : (e.getAttribute("data-chat") ?? e.getAttribute("type"))))).toEqual(["plus", "pill", "dictate", "submit"]);
    const talk = document.querySelector('[data-chat="live-talk"]') as HTMLElement;
    expect(form.contains(talk)).toBe(false);
    expect(talk.querySelector("[data-orb]")).not.toBeNull(); // the orb IS the button
    expect(talk.querySelector(".orb")).not.toBeNull(); // the animated flow orb (owner, 1 Nov: the flat icon was a wrong turn), not a flat circle
    expect(talk.querySelector("svg")).toBeNull();
    expect(document.querySelector('[data-chat="panel"] header, [data-chat="panel"] > div:first-child')?.contains(talk)).toBe(true); // at the top
    expect(talk).not.toHaveTextContent("Talk"); // no separate Talk pill any more
    expect(document.querySelector('[data-chat="talk-caption"]')).toHaveTextContent("Tap to talk");
  });
  it("the box is a multi-line text area: Enter sends, Shift+Enter is a new line, a composing keyboard is not cut short", async () => {
    draw();
    const box = screen.getByLabelText("Type, dictate, or go Live");
    expect(box.tagName).toBe("TEXTAREA");
    await type("how many enquiries today?");
    await act(async () => void fireEvent.keyDown(box, { key: "Enter", shiftKey: true }));
    expect(asked).toEqual([]);
    await act(async () => void fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })); // an IME confirming a word
    expect(asked).toEqual([]);
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(asked).toEqual(["how many enquiries today?"]);
  });
  it("Dictate: the words appear in the box AS THEY ARE SPOKEN (the API's words-only mode: no answer, no sound), nothing is asked until Send, and the reply is text", async () => {
    draw();
    const box = screen.getByLabelText("Type, dictate, or go Live");
    await open(/^Dictate/);
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", mode: "dictate", access_token: "tok" });
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {}, mode: "dictate" }));
    expect(screen.getByRole("button", { name: "Stop dictating" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Live talk/ })).toBeDisabled(); // one microphone at a time
    expect(box).toHaveAttribute("readonly");
    await act(async () => void sock.say({ type: "transcript", text: "how many", final: false }));
    expect(box).toHaveValue("how many"); // word by word
    await act(async () => void sock.say({ type: "transcript", text: "how many enquiries today", final: true }));
    expect(box).toHaveValue("how many enquiries today");
    await act(async () => void sock.say({ type: "limit", reason: "idle", fatal: true }));
    await act(async () => void sock.onclose?.({ code: 1000, reason: "" }));
    expect(box).not.toHaveAttribute("readonly");
    expect(asked).toEqual([]); // nothing is asked by dictating
    expect(sock.types()).not.toContain("barge_in");
    await type("how many enquiries today?"); // the words can be edited
    await send();
    expect(asked).toEqual(["how many enquiries today?"]);
    expect(document.querySelector('[data-chat="assistant"]')).not.toBeNull();
  });
  it("Dictate keeps what was already typed in front of the new words, and a tap on Stop ends it at once", async () => {
    draw();
    await type("price of");
    await open(/^Dictate/);
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {}, mode: "dictate" }));
    await act(async () => void sock.say({ type: "transcript", text: "silk", final: false }));
    expect(screen.getByLabelText("Type, dictate, or go Live")).toHaveValue("price of silk");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop dictating" })));
    expect(sock.types()).toContain("stop");
    expect(screen.getByLabelText("Type, dictate, or go Live")).toHaveValue("price of silk");
  });
  it("Dictate with nobody speaking says so in words and leaves the box as it was", async () => {
    draw();
    await type("my own words");
    await open(/^Dictate/);
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {}, mode: "dictate" }));
    await act(async () => void sock.say({ type: "limit", reason: "idle", fatal: true }));
    await act(async () => void sock.onclose?.({ code: 1000, reason: "" }));
    expect(document.querySelector('[data-chat="dictate-error"]')).not.toBeNull();
    expect(screen.getByLabelText("Type, dictate, or go Live")).toHaveValue("my own words");
  });
  it("Live talk joins the written conversation: the typed turn's conversation id goes in `start`, and one the API starts is kept for the next typed message", async () => {
    draw();
    await type("price of silk?");
    await send();
    await open(/^Live talk: a spoken/);
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", conversation_id: "55555555-5555-4555-8555-555555555555" });
    expect(JSON.parse(sock.sent[0] as string).mode).toBeUndefined();
  });
  it("Live talk says the hourly limit in words and goes on (a refusal that does not end the session)", async () => {
    draw();
    await open(/^Live talk: a spoken/);
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void sock.say({ type: "error", code: "run_limit_reached", message: "x", fatal: false }));
    expect(document.querySelector('[data-chat="live-problem"]')).not.toBeNull();
    expect(document.querySelector('[data-chat="live-badge"]')).not.toBeNull();
  });
  it("Live talk: a clear Live indicator and a Stop button while it runs; typed, dictated and live turns share ONE thread; about 30 s of silence ends it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    draw();
    await type("price of silk?");
    await send();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Listening");
    expect(document.querySelector('[data-chat="mic"]')).not.toBeNull(); // the microphone indicator is on while it listens
    expect(screen.getByRole("button", { name: "Stop live talk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Dictate/ })).toBeDisabled();
    await act(async () => void sock.say({ type: "caption", who: "user", text: "how many enquiries today", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Five.", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "listening" })); // it listens again by itself
    expect([...document.querySelectorAll('[data-chat="you"]')].map((e) => e.textContent).join("|")).toContain("price of silk?");
    expect([...document.querySelectorAll('[data-chat="you"]')].map((e) => e.textContent).join("|")).toContain("how many enquiries today");
    expect(sock.types()).not.toContain("stop");
    await act(async () => void vi.advanceTimersByTime(29_000));
    expect(sock.types()).not.toContain("stop");
    await act(async () => void vi.advanceTimersByTime(2_000));
    expect(sock.types()).toContain("stop"); // 30 s of nobody speaking
    vi.useRealTimers();
  });
  it("Live talk shows its state in words: Listening, Thinking, Speaking, and the microphone indicator all the while", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Connecting");
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    for (const [state, word] of [["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"]] as const) {
      await act(async () => void sock.say({ type: "state", state }));
      expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent(word);
      expect(document.querySelector('[data-chat="live-badge"]')?.getAttribute("data-state")).toBe(state);
      expect(document.querySelector('[data-chat="mic"]')).not.toBeNull();
    }
  });
  it("after 8 s of quiet one check-in appears and the state reads Paused; a word brings it back; 30 s end it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void vi.advanceTimersByTime(6_000));
    expect(document.querySelector('[data-chat="check-in"]')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(3_000));
    expect(document.querySelector('[data-chat="check-in"]')).toHaveTextContent(/Still there\?.*\d+ s/);
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Paused");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "yes", final: false, spoken: true }));
    await act(async () => void vi.advanceTimersByTime(1_000));
    expect(document.querySelector('[data-chat="check-in"]')).toBeNull();
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Listening");
    await act(async () => void vi.advanceTimersByTime(31_000));
    expect(sock.types()).toContain("stop");
    vi.useRealTimers();
  });
  it("warns two minutes before the time limit, with the time left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: { session_seconds: 300 } }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void vi.advanceTimersByTime(170_000));
    expect(document.querySelector('[data-chat="session-warning"]')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(15_000));
    expect(document.querySelector('[data-chat="session-warning"]')).toHaveTextContent(/Live talk ends in 1:\d\d/);
    vi.useRealTimers();
  });
  it("a turn the person spoke over is marked Interrupted in the thread", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void sock.say({ type: "caption", who: "user", text: "tell me everything", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "There are five", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "interrupted", ms: 120 }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    const thread = document.querySelector('[data-chat="thread"]')!;
    expect(thread.querySelector('[data-chat="interrupted"]')).toHaveTextContent("Interrupted");
  });
  it("an error offers Type instead, which puts the cursor in the box; the microphone off while the tab is hidden", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelector('[data-chat="type-instead"]')).toBeNull();
    await act(async () => void sock.say({ type: "error", code: "run_limit_reached", message: "x", fatal: false }));
    const btn = document.querySelector('[data-chat="type-instead"]') as HTMLButtonElement;
    expect(btn).toHaveTextContent("Type instead");
    await act(async () => void fireEvent.click(btn));
    expect(document.activeElement).toBe(document.getElementById("chat-input"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(sock.types()).toContain("stop");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  it("the API's own events: Paused while it judges a sound, its two-minute notice, and a goodbye that ends without an explanation", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void sock.say({ type: "state", state: "paused" }));
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Paused");
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    expect(document.querySelector('[data-chat="live-badge"]')).toHaveTextContent("Speaking");
    await act(async () => void sock.say({ type: "notice", code: "session_ending", seconds_left: 118 }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });
    expect(document.querySelector('[data-chat="session-warning"]')).toHaveTextContent(/Live talk ends in 1:5\d/);
    await act(async () => void sock.say({ type: "limit", reason: "goodbye", fatal: true }));
    await act(async () => void sock.onclose?.({ code: 1000, reason: "" }));
    expect(document.querySelector('[data-chat="live-badge"]')).toBeNull();
    expect(screen.queryByText(/chat has ended/)).toBeNull(); // a goodbye needs no explaining
  });
  it("Stop ends Live talk at once", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop live talk" })));
    expect(sock.types()).toContain("stop");
  });
});

describe("the conversation panel", () => {
  it("is a small chat: one line to write in, the microphone and a send button; no 'Ask' or 'Do it' button, no full-screen layer", () => {
    draw();
    expect(screen.getByRole("dialog", { name: "Your assistant" })).toHaveAttribute("aria-modal", "false");
    expect(screen.queryByRole("button", { name: /^(Ask|Do it)$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Live talk: a spoken/ })).toBeInTheDocument();
    expect(screen.getByText(/Ask anything about your business, or just talk/)).toBeInTheDocument();
    const panel = document.querySelector('[data-chat="panel"]') as HTMLElement;
    expect(panel.className).not.toMatch(/(^|\s)(md:)?h-\[/); // no fixed height: it fits what is in it
    expect(panel.className).toContain("max-h-[min(560px"); // and grows with the conversation up to about 560px, then the thread scrolls inside
    expect(panel.className).not.toContain("overflow-hidden"); // (the plus menu opens upward over it)
  });
  it("empty: the greeting and the chips come directly under each other, then the input; no big blank area (the chips are above the input)", () => {
    draw();
    const empty = document.querySelector('[data-chat="empty"]') as HTMLElement;
    expect(empty).toHaveTextContent(/Ask anything about your business/);
    expect(empty.querySelector('[data-chat="chips"]')).not.toBeNull();
    const form = document.querySelector('[data-chat="form"]') as HTMLElement;
    expect(empty.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", access_token: "tok", language: "en" });
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(orbs.at(-1)).toBe("listen");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "how many en", final: false, spoken: true }));
    expect(document.querySelector('[data-chat="you-live"]')).toHaveTextContent("how many en"); // live in the thread, word by word (the box is for typing and dictating) // live, word by word
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
  it("a spoken action: the words show live as transcripts, the plan joins the thread with Yes / No, and a spoken yes (the API's answer) flips the card", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void sock.say({ type: "transcript", text: "call the new", final: false, seq: 1, t_ms: 250 }));
    expect(document.querySelector('[data-chat="you-live"]')).toHaveTextContent("call the new"); // live in the thread, word by word (the box is for typing and dictating)
    await act(async () => void sock.say({ type: "transcript", text: "call the new leads", final: true, seq: 2, t_ms: 700 }));
    await act(async () => void sock.say({ type: "caption", who: "user", text: "call the new leads", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "I will call 12 new leads today. Shall I go ahead?", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "confirm_action", action_id: PLAN.actionId, title: PLAN.title, summary: PLAN.summary, steps: PLAN.steps, count: 12, channel: "call", estimate: { messages: 0, call_minutes: 30, cost_paise: 1200 }, needs_second_factor: false, expires_at: "2026-10-28T20:00:00Z", status: "proposed" }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    const card = document.querySelector('[data-chat="plan"]') as HTMLElement;
    expect(card).toHaveTextContent("Call 12 new leads");
    expect(within(card).getByRole("button", { name: "Yes, do it" })).toBeInTheDocument();
    expect([...document.querySelectorAll('[data-chat="you"]')].map((e) => e.textContent).filter((t) => t?.includes("call the new leads"))).toHaveLength(1); // not twice
    await act(async () => void sock.say({ type: "action", action_id: PLAN.actionId, status: "confirmed", task: { id: "t", status: "approved" } }));
    expect(document.querySelector('[data-chat="plan"]')).toHaveTextContent("Approved. It is being done.");
    expect(within(document.querySelector('[data-chat="plan"]') as HTMLElement).queryByRole("button", { name: "Yes, do it" })).toBeNull();
  });
  it("a tap while it talks stops the speech (barge-in); the words heard can be edited if misheard; Escape ends the conversation and closes", async () => {
    const onClose = vi.fn();
    draw({ onClose });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop talking" })));
    expect(sock.types()).toContain("barge_in");
    await act(async () => void sock.say({ type: "caption", who: "user", text: "pri silk", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Ok.", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Edit what I heard" })));
    expect(screen.getByLabelText("Type, dictate, or go Live")).toHaveValue("pri silk"); // "Edit" puts the heard words in the box
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
    expect(asks.at(-1)).toMatchObject({ question: "and yesterday?", conversationId: id });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Earlier conversations" })));
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Hide" })));
    expect(sideCalls.at(-1)).toEqual({ op: "archive", id });
    expect(screen.queryByText("Price of silk")).toBeNull();
  });
  it("in Today's card it is the same chat in its place: no dialog, no full screen, no Done or Never mind; a waveform shows until the first words, which then show live", async () => {
    draw({ variant: "card" });
    expect(document.querySelector('[data-chat="card"]')).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('[data-chat="close"]')).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelector('[data-chat="wave"]')).not.toBeNull(); // listening, nothing heard yet
    await act(async () => void sock.say({ type: "caption", who: "user", text: "call the", final: false, spoken: true }));
    expect(document.querySelector('[data-chat="wave"]')).toBeNull();
    expect(document.querySelector('[data-chat="you-live"]')).toHaveTextContent("call the"); // live in the thread, word by word (the box is for typing and dictating)
    expect(screen.queryByRole("button", { name: /^(Done|Never mind)$/ })).toBeNull();
    expect(document.querySelector('[data-part="voice-chat"], [data-voice="mode"]')).toBeNull();
  });
  it("a spoken turn is ONE bubble (interim updates in place, the final replaces it), the reply pieces make ONE text, and a chat that went quiet leaves the panel as it was: no 'chat has ended' line, the microphone starts a new chat without a greeting", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    for (const [text, final] of [["how", false], ["how many", false], ["How many enquiries?", true]] as const) {
      await act(async () => void sock.say({ type: "caption", who: "user", text, final, spoken: true }));
      await act(async () => void sock.say({ type: "transcript", text, final, seq: 1, t_ms: 1 }));
    }
    await act(async () => void sock.say({ type: "state", state: "thinking" }));
    for (const piece of ["Great, th", "anks for pic", "king up."]) await act(async () => void sock.say({ type: "caption", who: "assistant", text: piece, final: true, spoken: true }));
    expect(document.querySelectorAll('[data-chat="you-live"], [data-chat="you"]')).toHaveLength(1);
    expect(document.querySelector('[data-chat="assistant-live"]')).toHaveTextContent("Great, thanks for picking up.");
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelectorAll('[data-chat="you"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-chat="assistant"]')).toHaveLength(1);
    expect(document.querySelector('[data-chat="assistant"]')).toHaveTextContent("Great, thanks for picking up.");
    await act(async () => void sock.say({ type: "limit", reason: "idle", fatal: true }));
    await act(async () => void sock.onclose?.({ code: 1000, reason: "" }));
    expect(screen.queryByText(/chat has ended|went quiet|Tap the circle/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Live talk: a spoken/ })).toBeInTheDocument();
    const first = sock;
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    expect(sock).not.toBe(first);
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s2", language: "en", limits: {} }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Hi, how can I help?", final: true, spoken: true }));
    expect(screen.queryByText("Hi, how can I help?")).toBeNull(); // no greeting again
  });
  it("under the circle it says which voice speaks, as the API says it at the start of the turn: 'Speaking in Telugu · Ramya'", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelector('[data-chat="speaking-in"]')).toBeNull();
    await act(async () => void sock.say({ type: "voice", voice_id: "te-ramya", language: "te", name: "Ramya" }));
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    expect(document.querySelector('[data-chat="speaking-in"]')).toHaveTextContent("Speaking in తెలుగు · Ramya");
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(document.querySelector('[data-chat="speaking-in"]')).toBeNull();
  });
});

describe("the command bar (owner's design C) and the language pill", () => {
  beforeEach(() => window.localStorage.removeItem("sme_chat_lang"));
  it("is the orb on the left (64px, the Talk button, a soft ring, 'Tap to talk') and the composer card on the right with the chips under it; no empty chat area", () => {
    draw({ variant: "bar" });
    const bar = document.querySelector('[data-chat="bar"]') as HTMLElement;
    const talk = bar.querySelector('[data-chat="live-talk"]') as HTMLElement;
    expect(talk.querySelector("[data-orb]")).not.toBeNull();
    expect(talk.querySelector('[data-chat="ring"]')).not.toBeNull();
    expect(bar.querySelector('[data-chat="talk-caption"]')).toHaveTextContent("Tap to talk");
    const form = bar.querySelector('[data-chat="form"]') as HTMLElement;
    expect(form.className).toContain("rounded-[16px]");
    expect(form.querySelector("textarea")).toHaveAttribute("placeholder", "Ask or tell your assistant anything…");
    expect([...form.querySelectorAll('[data-chat="toolbar"] select, [data-chat="toolbar"] button')].map((e) => (e.tagName === "SELECT" ? "pill" : (e.getAttribute("data-chat") ?? e.getAttribute("type"))))).toEqual(["plus", "pill", "dictate", "submit"]);
    expect(bar.contains(talk) && !form.contains(talk)).toBe(true);
    expect(talk.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the orb is on the LEFT of the composer
    expect(form.compareDocumentPosition(bar.querySelector('[data-chat="chips"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the chips under the composer
    expect(bar.querySelector('[data-chat="body"]')?.className).toContain("hidden"); // no empty chat area
  });
  it("the orb is the Talk button: a tap starts Live talk, the caption follows the state, a tap again ends it; the ring pulses with the sound", async () => {
    draw({ variant: "bar" });
    const talk = () => document.querySelector('[data-chat="bar"] [data-chat="live-talk"]') as HTMLElement;
    const caption = () => document.querySelector('[data-chat="talk-caption"]') as HTMLElement;
    await act(async () => void fireEvent.click(talk()));
    await act(async () => void sock.onopen?.());
    expect(caption()).toHaveTextContent("Connecting");
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "en", limits: {} }));
    for (const [state, word] of [["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"], ["paused", "Paused"]] as const) {
      await act(async () => void sock.say({ type: "state", state }));
      expect(caption()).toHaveTextContent(word);
    }
    expect(talk()).toHaveAttribute("aria-pressed", "true");
    expect(talk().getAttribute("aria-label")).toMatch(/Stop live talk/);
    expect(talk().querySelector('[data-chat="ring"]')?.className).toContain("border-brand-edge ");
    await act(async () => void fireEvent.click(talk()));
    expect(sock.types()).toContain("stop");
  });
  it("the conversation opens under the composer with its own header: 'Your assistant · speaking in <language> · <voice>' and Minimise", async () => {
    window.localStorage.setItem("sme_chat_lang", "te");
    draw({ variant: "bar" });
    await type("price of silk?");
    await send();
    const header = document.querySelector('[data-chat="speaking-in"]') as HTMLElement;
    expect(header.parentElement).toHaveTextContent("Your assistant · speaking in తెలుగు");
    expect(document.querySelector('[data-chat="minimise"]')).toBeInTheDocument();
    window.localStorage.removeItem("sme_chat_lang");
  });
  it("the language pill offers Auto, Telugu, English, Hindi, Kannada, Tamil, Malayalam, starts as the app language and remembers the choice", async () => {
    draw({ variant: "bar" });
    const pill = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    expect([...pill.options].map((o) => o.text)).toEqual(["Auto", "తెలుగు", "English", "हिंदी", "ಕನ್ನಡ", "தமிழ்", "മലയാളം"]);
    expect(pill.value).toBe("en"); // the app's language
    await act(async () => void fireEvent.change(pill, { target: { value: "te" } }));
    expect(window.localStorage.getItem("sme_chat_lang")).toBe("te");
    cleanup();
    draw({ variant: "bar" });
    expect((screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement).value).toBe("te"); // remembered
  });
  it("Telugu on the pill: Live talk starts in Telugu with the recogniser pinned to it; Auto: no pin; changing it while talking tells the API", async () => {
    window.localStorage.setItem("sme_chat_lang", "te");
    draw({ variant: "bar" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", language: "te", stt_language: "te" });
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "hi" } }));
    expect(sock.sent.map((m) => (typeof m === "string" ? JSON.parse(m) : null)).filter(Boolean).some((m) => m.type === "set_language" && m.language === "hi")).toBe(true);
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "auto" } }));
    expect(sock.sent.map((m) => (typeof m === "string" ? JSON.parse(m) : null)).filter(Boolean).some((m) => m.type === "set_language" && m.language === "auto")).toBe(true); // Auto un-pins
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop live talk" })));
    cleanup();
    window.localStorage.setItem("sme_chat_lang", "auto");
    draw({ variant: "bar" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Live talk: a spoken/ })));
    await act(async () => void sock.onopen?.());
    const start = JSON.parse(sock.sent[0] as string);
    expect(start.language).toBe("en"); // Auto answers in the app's language
    expect(start).not.toHaveProperty("stt_language");
  });
  it("Dictate follows the pill too, and the plus menu holds a new conversation and the history", async () => {
    window.localStorage.setItem("sme_chat_lang", "kn");
    draw({ variant: "bar" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Dictate/ })));
    await act(async () => void sock.onopen?.());
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ type: "start", mode: "dictate", language: "kn", stt_language: "kn" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop dictating" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "More" })));
    expect(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });
  it("a person whose profile says Hindi sees Hindi on the pill; picking a language saves it on the profile (a plain POST) and in this browser", async () => {
    voiceOverride = { chatLanguage: "hi", chatLanguageUrl: "/app/tenants/t/chat-language" };
    draw({ variant: "bar" });
    const pill = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    expect(pill.value).toBe("hi"); // the profile's choice, not the app's language
    await act(async () => void fireEvent.change(pill, { target: { value: "kn" } }));
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string, { body?: string }][] } };
    const saved = fetchMock.mock.calls.find((c) => c[0] === "/app/tenants/t/chat-language");
    expect(JSON.parse(saved![1].body!)).toEqual({ language: "kn" });
    expect(window.localStorage.getItem("sme_chat_lang")).toBe("kn");
    voiceOverride = {};
  });
  it("a typed question carries the pill: Telugu is asked in Telugu, Auto sends the word auto", async () => {
    window.localStorage.setItem("sme_chat_lang", "te");
    draw({ variant: "bar" });
    await type("price of silk?");
    await send();
    expect(asks.at(-1)).toMatchObject({ question: "price of silk?", replyLanguage: "te" });
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "auto" } }));
    await type("and cotton?");
    await send();
    expect(asks.at(-1)).toMatchObject({ question: "and cotton?", replyLanguage: "auto" });
  });
  it("the sheet on a phone has the same composer, with the orb at its top as the Talk button", () => {
    draw({ variant: "panel" });
    const form = document.querySelector('[data-chat="form"]') as HTMLElement;
    expect([...form.querySelectorAll('[data-chat="toolbar"] select, [data-chat="toolbar"] button')].map((e) => (e.tagName === "SELECT" ? "pill" : (e.getAttribute("data-chat") ?? e.getAttribute("type"))))).toEqual(["plus", "pill", "dictate", "submit"]);
    const talk = document.querySelector('[data-chat="live-talk"]') as HTMLElement;
    expect(talk.querySelector("[data-orb]")).not.toBeNull();
    expect(talk.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the orb is above the composer
  });
});
