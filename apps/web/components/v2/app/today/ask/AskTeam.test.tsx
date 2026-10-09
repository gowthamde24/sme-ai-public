import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";

import { AskTeam, insideWorkspace } from "./AskTeam";
import { ASK_WORD_KEYS } from "./ask-words";
import type { AskEvent, AskTransport } from "./ask-types";
import { speechLang, speechProblem, transcriptOf } from "./speech";

const en = appT("en");
const WORDS = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const B = "/app/tenants/T";
const Q = { answer: "Two quotes wait for you.\nNothing was sent." };

/** A transport that plays the given events, one per tick, and records what it was asked. */
function playing(events: AskEvent[], seen: { question: string; lang: string; signal: AbortSignal }[] = []): AskTransport {
  return async function* (req) {
    seen.push(req);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  };
}
const box = (transport: AskTransport | null, availability: "live" | "not_available" | "switched_off" = "live", lang = "en") => render(<AskTeam lang={lang} base={B} words={WORDS} availability={availability} transport={transport} />);
const ask = (text: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Your question for the Main agent" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AskTeam: not available", () => {
  it.each([
    ["no answer stream yet", null, "live", "Not available yet"],
    ["the Main agent is not built", playing([]), "not_available", "Not available yet"],
    ["its switch is off", playing([]), "switched_off", "Switched off"],
  ] as const)("%s: the title, the reason and nothing to press", (_l, transport, availability, reason) => {
    box(transport, availability);
    const region = screen.getByRole("region", { name: "Ask your team" });
    expect(region).toHaveAttribute("data-ask", "unavailable");
    expect(within(region).getByText(reason)).toBeInTheDocument();
    expect(within(region).queryByRole("textbox")).toBeNull();
    expect(within(region).queryByRole("button")).toBeNull();
  });
  it("never calls the transport while it is not available", () => {
    const seen: unknown[] = [];
    box(playing([], seen as never), "not_available");
    expect(seen).toHaveLength(0);
  });
});

describe("AskTeam: asking", () => {
  it("shows the input, the four starter questions and the Main agent's name, and Ask stays off until something is typed", () => {
    box(playing([]));
    expect(screen.getByRole("region", { name: "Ask your team" })).toHaveAttribute("data-ask", "live");
    expect(screen.getByText("Answers from your own records. It changes nothing.")).toBeInTheDocument();
    for (const q of ["What needs me today?", "Which quotes are waiting for me?", "How much customer money is held?", "What did the team do today?"]) expect(screen.getByRole("button", { name: q })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });
  it("streams the answer as plain text, in order, and lists where it came from", async () => {
    const seen: { question: string; lang: string; signal: AbortSignal }[] = [];
    box(playing([{ type: "text", delta: "Two quotes " }, { type: "text", delta: "wait for you.\nNothing was sent." }, { type: "source", label: "Today · Needs you", href: `${B}?x=1` }, { type: "source", label: "Orders · ORD-1", href: `${B}/orders/O1` }, { type: "done" }], seen), "live", "te");
    ask("What needs me today?");
    await waitFor(() => expect(screen.getByText(/Two quotes wait for you\./)).toBeInTheDocument());
    expect(seen).toHaveLength(1);
    expect(seen[0].question).toBe("What needs me today?");
    expect(seen[0].lang).toBe("te");
    expect(screen.getByText("You asked: What needs me today?")).toBeInTheDocument();
    expect(screen.getByText(/Two quotes wait for you\./).textContent).toBe(Q.answer);
    await waitFor(() => expect(screen.getByRole("link", { name: "Orders · ORD-1" })).toHaveAttribute("href", `${B}/orders/O1`));
    expect(screen.getByRole("link", { name: "Today · Needs you" })).toHaveAttribute("href", `${B}?x=1`);
    expect(screen.getByText("Where this came from")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("a starter question is asked at once", async () => {
    const seen: { question: string; lang: string; signal: AbortSignal }[] = [];
    box(playing([{ type: "text", delta: "Done." }, { type: "done" }], seen));
    fireEvent.click(screen.getByRole("button", { name: "Which quotes are waiting for me?" }));
    await waitFor(() => expect(screen.getByText("Done.")).toBeInTheDocument());
    expect(seen[0].question).toBe("Which quotes are waiting for me?");
  });
  it("draws what the answer says as text only: markup in it is shown, never run", async () => {
    box(playing([{ type: "text", delta: '<img src=x onerror="alert(1)"> **bold** <b>b</b>' }, { type: "done" }]));
    ask("x");
    await waitFor(() => expect(screen.getByText(/onerror/)).toBeInTheDocument());
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
  it("says it is working until the first word arrives", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    box((async function* () {
      await gate;
      yield { type: "text", delta: "Hello." } as AskEvent;
    }) as AskTransport);
    ask("hi");
    expect(screen.getByText("Looking at your records…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(screen.getByText("Hello.")).toBeInTheDocument());
  });
  it("Stop ends the question and ignores what arrives afterwards", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let signal: AbortSignal | null = null;
    box((async function* (req) {
      signal = req.signal;
      yield { type: "text", delta: "Part one. " } as AskEvent;
      await gate;
      yield { type: "text", delta: "Late." } as AskEvent;
    }) as AskTransport);
    ask("hi");
    await waitFor(() => expect(screen.getByText(/Part one\./)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal!.aborted).toBe(true);
    await act(async () => release());
    expect(screen.queryByText(/Late\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  });
  it("an error, thrown or sent, says nothing was changed and offers the questions again", async () => {
    box(playing([{ type: "text", delta: "Half an answer." }, { type: "error" }]));
    ask("x");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The answer could not be completed. Nothing was changed."));
    expect(screen.getByRole("button", { name: "What needs me today?" })).toBeInTheDocument();
    cleanup();
    box((async function* () {
      yield { type: "text", delta: "x" } as AskEvent;
      throw new Error("boom");
    }) as AskTransport);
    ask("x");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
  it("a new question replaces the old answer, sources and drafts", async () => {
    let n = 0;
    box((async function* () {
      n += 1;
      yield { type: "text", delta: `Answer ${n}.` } as AskEvent;
      if (n === 1) yield { type: "draft", id: "d1", kind: "quote", title: "Quote 1", summary: "s", href: `${B}/quotes` } as AskEvent;
    }) as AskTransport);
    ask("one");
    await waitFor(() => expect(screen.getByText("Answer 1.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("article", { name: "Quote 1" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "What needs me today?" }));
    await waitFor(() => expect(screen.getByText("Answer 2.")).toBeInTheDocument());
    expect(screen.queryByText("Answer 1.")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("AskTeam: drafts and what the answer may link to", () => {
  it("a draft is a Draft card whose Approve opens the screen that decides, with the line saying nothing is approved from here", async () => {
    box(playing([{ type: "draft", id: "q1", kind: "quote", title: "Quote for Pooja Sarees", summary: "5 sarees, ₹65,625.", href: `${B}/enquiries/E?quote=Q` }, { type: "draft", id: "f1", kind: "followup_draft", title: "Follow-up to Meera", summary: "A reminder.", href: `${B}/leads/L` }, { type: "done" }]));
    ask("x");
    const card = await screen.findByRole("article", { name: "Quote for Pooja Sarees" });
    expect(within(card).getByText("Draft")).toBeInTheDocument();
    expect(within(card).getByText("Quote draft")).toBeInTheDocument();
    expect(within(card).getByText("5 sarees, ₹65,625.")).toBeInTheDocument();
    const approve = within(card).getByRole("link", { name: /Approve/ });
    expect(approve).toHaveAttribute("href", `${B}/enquiries/E?quote=Q`);
    expect(within(card).getByText("Opens the screen where you check and approve it. Nothing is approved or sent from here.")).toBeInTheDocument();
    expect(within(card).queryByRole("button")).toBeNull(); // a link: nothing is sent by pressing it
    expect(within(screen.getByRole("article", { name: "Follow-up to Meera" })).getByText("Follow-up draft")).toBeInTheDocument();
  });
  it("drops any link that leaves this workspace: another host, another workspace, a script, a path trick", async () => {
    box(playing([
      { type: "source", label: "evil", href: "https://evil.example/x" },
      { type: "source", label: "other workspace", href: "/app/tenants/OTHER/orders" },
      { type: "source", label: "script", href: "javascript:alert(1)" },
      { type: "source", label: "dots", href: `${B}/../OTHER/orders` },
      { type: "source", label: "double slash", href: `${B}//evil.example` },
      { type: "source", label: "fine", href: `${B}/orders` },
      { type: "draft", id: "d", kind: "quote", title: "Bad draft", summary: "s", href: "https://evil.example/approve" },
      { type: "done" },
    ]));
    ask("x");
    await screen.findByRole("link", { name: "fine" });
    expect(screen.queryByRole("link", { name: /evil|other workspace|script|dots|double slash/ })).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("shows each source and draft once, and no more than a handful", async () => {
    box(playing([
      ...Array.from({ length: 12 }, (_, i) => ({ type: "source", label: `S${i}`, href: `${B}/orders/${i}` }) as AskEvent),
      { type: "source", label: "S0 again", href: `${B}/orders/0` },
      ...Array.from({ length: 9 }, (_, i) => ({ type: "draft", id: `d${i}`, kind: "quote", title: `D${i}`, summary: "s", href: `${B}/quotes` }) as AskEvent),
      { type: "draft", id: "d0", kind: "quote", title: "D0 again", summary: "s", href: `${B}/quotes` },
    ]));
    ask("x");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(5));
    expect(screen.getAllByRole("link", { name: /^S\d+$/ })).toHaveLength(8);
    expect(screen.queryByText("S0 again")).toBeNull();
    expect(screen.queryByText("D0 again")).toBeNull();
  });
  it("insideWorkspace keeps a path of this workspace and refuses everything else", () => {
    expect(insideWorkspace(`${B}/orders/1?x=2`, B)).toBe(`${B}/orders/1?x=2`);
    expect(insideWorkspace(B, B)).toBe(B);
    expect(insideWorkspace(`${B}#needs-you`, B)).toBe(`${B}#needs-you`);
    for (const bad of ["", "https://x.test/", `${B}/../x`, `${B}/%2e%2e/x`.replace("%2e%2e", ".."), "//evil.test/app/tenants/T/x", `${B}\\x`, `${B}/x\n`, `/app/tenants/TT/x`, `${B}x/y`, "x".repeat(400)]) expect(insideWorkspace(bad, B), bad).toBeNull();
    expect(insideWorkspace(undefined as never, B)).toBeNull();
  });
});

describe("AskTeam: the real Main agent's shapes (Job AG)", () => {
  it("a source with no screen of its own is a plain label, not a link", async () => {
    box(playing([{ type: "text", delta: "Ok." }, { type: "source", label: "Pooja Sarees (company)", href: null }, { type: "source", label: "Order 1", href: `${B}/orders/O1` }, { type: "done" }]));
    ask("x");
    await screen.findByRole("link", { name: "Order 1" });
    expect(screen.getByText("Pooja Sarees (company)").closest("a")).toBeNull();
  });
  it("a customer reply shows the words in the customer's language, the English meaning, the machine label, and NO Approve link when no screen approves it", async () => {
    box(playing([{ type: "draft", id: "r1", kind: "reply_draft", title: "Reply draft (machine-written)", summary: "నమస్కారం, మీ ఎంక్వైరీకి ధన్యవాదాలు.", href: null, language: "te", gloss: "Hello, thank you for your enquiry.", machine: true }, { type: "done" }]));
    ask("x");
    const card = await screen.findByRole("article", { name: "Reply draft (machine-written)" });
    expect(within(card).getByText("నమస్కారం, మీ ఎంక్వైరీకి ధన్యవాదాలు.")).toHaveAttribute("lang", "te");
    expect(within(card).getByText(/Hello, thank you for your enquiry\./)).toBeInTheDocument();
    expect(within(card).getByText("In English:")).toBeInTheDocument();
    expect(within(card).getByText("Written by a machine")).toBeInTheDocument();
    expect(within(card).getByText("Customer reply")).toBeInTheDocument();
    expect(within(card).getByText("Draft")).toBeInTheDocument();
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).getByText("Nothing was sent. No screen approves this reply yet.")).toBeInTheDocument();
  });
  it("a follow-up draft and an enquiry draft each say what they are and open the screen that decides", async () => {
    box(playing([{ type: "draft", id: "f", kind: "followup_draft", title: "Follow-up", summary: "s", href: `${B}/leads/L` }, { type: "draft", id: "e", kind: "enquiry", title: "Enquiry", summary: "s", href: `${B}/enquiries/E` }, { type: "done" }]));
    ask("x");
    const f = await screen.findByRole("article", { name: "Follow-up" });
    expect(within(f).getByText("Follow-up draft")).toBeInTheDocument();
    expect(within(f).getByRole("link", { name: /Approve/ })).toHaveAttribute("href", `${B}/leads/L`);
    expect(within(screen.getByRole("article", { name: "Enquiry" })).getByText("Enquiry", { selector: "span" })).toBeInTheDocument();
  });
  it.each([
    ["cost_cap_reached", "Today's AI spending limit has been reached. Try again tomorrow."],
    ["run_limit_reached", "Too many questions just now. Wait a little and ask again."],
    ["forbidden", "Your role cannot ask the team."],
    ["agents_disabled", "Switched off"],
    ["something_else", "The answer could not be completed. Nothing was changed."],
    [undefined, "The answer could not be completed. Nothing was changed."],
  ])("an error with code %s says its own fixed sentence", async (code, words) => {
    box(playing([{ type: "error", code }]));
    ask("x");
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
  });
  it("the box asks the workspace's own route by default (the browser never holds the API token)", async () => {
    const fetcher = vi.fn(async () => new Response('{"type":"text","delta":"From the route."}\n{"type":"done"}\n', { headers: { "Content-Type": "application/x-ndjson" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<AskTeam lang="en" base={B} words={WORDS} availability="live" />);
    ask("What needs me today?");
    await screen.findByText("From the route.");
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe(`${B}/ask`);
    expect(String((calls[0][1].headers as Record<string, string>).Authorization)).toBe("undefined");
  });
});

describe("AskTeam: the microphone", () => {
  class FakeRecognition {
    static last: FakeRecognition | null = null;
    lang = "";
    interimResults = false;
    continuous = true;
    maxAlternatives = 0;
    onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
    onerror: ((e: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    stopped = false;
    constructor() {
      FakeRecognition.last = this;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
    abort() {
      this.stopped = true;
    }
  }
  beforeEach(() => {
    FakeRecognition.last = null;
  });

  it("is hidden when the browser has no speech recognition", () => {
    box(playing([]));
    expect(screen.queryByRole("button", { name: /Speak your question/ })).toBeNull();
  });
  it.each([
    ["en", "en-IN"], ["te", "te-IN"], ["hi", "hi-IN"], ["kn", "kn-IN"], ["ta", "ta-IN"], ["xx", "en-IN"],
  ])("listens in the language of the chip: %s is %s", (lang, code) => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    box(playing([]), "live", lang);
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    expect(FakeRecognition.last!.lang).toBe(code);
    expect(FakeRecognition.last!.started).toBe(true);
    expect(speechLang(lang)).toBe(code);
  });
  it("the webkit name works too", () => {
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    box(playing([]));
    expect(screen.getByRole("button", { name: "Speak your question" })).toBeInTheDocument();
  });
  it("puts what it heard in the box, interim words included, and does NOT send it: the person reads it and presses Ask", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const seen: unknown[] = [];
    box(playing([], seen as never));
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    expect(screen.getByRole("button", { name: "Stop listening" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Your browser may send what you say to its speech service.")).toBeInTheDocument();
    act(() => FakeRecognition.last!.onresult!({ results: [[{ transcript: "which quotes" }], [{ transcript: "are waiting" }]] }));
    expect(screen.getByRole("textbox")).toHaveValue("which quotes are waiting");
    act(() => FakeRecognition.last!.onend!());
    expect(screen.getByRole("button", { name: "Speak your question" })).toHaveAttribute("aria-pressed", "false");
    expect(seen).toHaveLength(0);
  });
  it("asking while it is listening ends the listening, and a late word does not come back into the box", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    box(playing([{ type: "text", delta: "Fine." }, { type: "done" }]));
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    fireEvent.click(screen.getByRole("button", { name: "What needs me today?" }));
    expect(FakeRecognition.last!.stopped).toBe(true);
    await screen.findByText("Fine.");
    expect(screen.getByRole("button", { name: "Speak your question" })).toHaveAttribute("aria-pressed", "false");
  });
  it("pressing the microphone again stops listening", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    box(playing([]));
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    expect(FakeRecognition.last!.stopped).toBe(true);
    expect(screen.getByRole("button", { name: "Speak your question" })).toBeInTheDocument();
  });
  it.each([
    ["not-allowed", "The microphone is not allowed. Type your question instead."],
    ["service-not-allowed", "The microphone is not allowed. Type your question instead."],
    ["no-speech", "Nothing was heard. Try again, or type your question."],
    ["network", "Could not listen. Type your question instead."],
  ])("a %s problem is said in words and typing still works", (code, words) => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    box(playing([]));
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    act(() => FakeRecognition.last!.onerror!({ error: code }));
    expect(screen.getByRole("status")).toHaveTextContent(words);
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
  it("a browser that refuses to start says so instead of throwing", () => {
    vi.stubGlobal("SpeechRecognition", class extends FakeRecognition {
      start() {
        throw new Error("already started");
      }
    });
    box(playing([]));
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    expect(screen.getByRole("status")).toHaveTextContent("Could not listen.");
  });
  it("helpers: the problem codes and the joined transcript", () => {
    expect(speechProblem(undefined)).toBe("failed");
    expect(transcriptOf([[{ transcript: " a  b " }], [], [{ transcript: "c" }]])).toBe("a b c");
  });
});

describe("AskTeam: touch and reading", () => {
  it("every control is at least 44px tall", () => {
    vi.stubGlobal("SpeechRecognition", class {});
    box(playing([]));
    for (const b of screen.getAllByRole("button")) expect(b.className, b.textContent ?? "").toMatch(/min-h-1[12]|size-12/);
    expect(screen.getByRole("textbox").className).toContain("min-h-12");
  });
  it("the input has a label a screen reader can find, and the answer area announces politely", async () => {
    box(playing([{ type: "text", delta: "Hi." }, { type: "done" }]));
    expect(screen.getByLabelText("Your question for the Main agent")).toBe(screen.getByRole("textbox"));
    ask("x");
    await screen.findByText("Hi.");
    expect(screen.getByText("Hi.").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });
});
