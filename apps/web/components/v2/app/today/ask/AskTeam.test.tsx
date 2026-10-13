import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";

import { AskTeam, insideWorkspace } from "./AskTeam";
import { ASK_WORD_KEYS } from "./ask-words";
import type { AskEvent, AskTransport } from "./ask-types";

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
  fireEvent.change(screen.getByRole("textbox", { name: "Your question for Agent OWL" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AskTeam: not available", () => {
  it.each([
    ["no answer stream yet", null, "live", "Not available yet"],
    ["the Agent OWL is not built", playing([]), "not_available", "Not available yet"],
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
  it("shows the input, the four starter questions and the Agent OWL's name, and Ask stays off until something is typed", () => {
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
    expect(document.querySelector("img:not(.plush-still)")).toBeNull(); // the answer's markup is never run (the owl's own still picture is not part of it)
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

describe("AskTeam: the real Agent OWL's shapes (Job AG)", () => {
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
  it("a visit Agent OWL proposed says it is a store visit and opens the Visits page at it", async () => {
    box(playing([{ type: "draft", id: "v", kind: "store_visit", title: "Proposed visit on 2026-10-14 at 11:30", summary: "A store visit I proposed. It is booked but not confirmed. Nothing has been sent.", href: `${B}/visits?visit=V` }, { type: "done" }]));
    ask("x");
    const v = await screen.findByRole("article", { name: "Proposed visit on 2026-10-14 at 11:30" });
    expect(within(v).getByText("Store visit")).toBeInTheDocument();
    expect(within(v).getByRole("link", { name: /Approve/ })).toHaveAttribute("href", `${B}/visits?visit=V`);
  });
  it.each([
    ["ai_paused_until", "Today's AI spending limit has been reached. Try again tomorrow."],
    ["run_limit_reached", "Too many questions just now. Wait a little and ask again."],
    ["forbidden", "Your role cannot ask the team."],
    ["agents_disabled", "Switched off"],
    ["model_busy", "Agent OWL is busy right now. Try again in a minute."],
    ["model_not_configured", "Agent OWL isn't set up yet. Ask the owner to turn it on."],
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

describe("AskTeam: sources wrap, and the owl follows the box", () => {
  const owlOf = () => document.querySelector(".plush")!.getAttribute("data-mood");
  it("a long source label is shown whole and may wrap, as a link and as a plain label", async () => {
    const long = "Quote Q-2041 · Pooja Sarees · total ₹12,48,500.00 incl. GST, advance ₹3,00,000.00 received, balance ₹9,48,500.00 due on dispatch";
    box(playing([{ type: "text", delta: "Ok." }, { type: "source", label: long, href: `${B}/quotes` }, { type: "source", label: `${long} (company)`, href: null }, { type: "done" }]));
    ask("x");
    const link = await screen.findByRole("link", { name: long });
    expect(link).toHaveTextContent(long);
    expect(link.className).toMatch(/overflow-wrap:anywhere/);
    expect(link.className).toMatch(/max-w-full/);
    expect(link.className).not.toMatch(/truncate|whitespace-nowrap|overflow-hidden/);
    const plain = screen.getByText(`${long} (company)`);
    expect(plain.className).toMatch(/overflow-wrap:anywhere/);
  });
  it("the owl rests while there is nothing to ask", () => {
    box(playing([]), "switched_off");
    expect(owlOf()).toBe("resting");
  });
  it("the owl is idle, then thinks until the first word, answers while it streams, and is idle again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transport: AskTransport = async function* () {
      await gate;
      yield { type: "text", delta: "Two quotes." };
      await gate;
      yield { type: "done" };
    };
    box(transport);
    expect(owlOf()).toBe("idle");
    ask("x");
    expect(owlOf()).toBe("thinking");
    release();
    expect(await screen.findByText("Two quotes.")).toBeInTheDocument();
    await waitFor(() => expect(owlOf()).toBe("idle"));
  });
  it("the owl listens while the person is typing in the focused box, and is idle again when the box loses the focus or is empty", () => {
    box(playing([]));
    const input = screen.getByRole("textbox", { name: "Your question for Agent OWL" });
    expect(owlOf()).toBe("idle");
    fireEvent.focus(input);
    expect(owlOf()).toBe("idle"); // focused, nothing typed yet
    fireEvent.change(input, { target: { value: "which" } });
    expect(owlOf()).toBe("listening");
    fireEvent.blur(input);
    expect(owlOf()).toBe("idle");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(owlOf()).toBe("idle");
  });
  it.each([
    ["ai_paused_until", "resting"],
    ["agents_disabled", "resting"],
    ["run_limit_reached", "resting"],
    ["model_busy", "idle"],
    ["model_not_configured", "idle"],
    ["forbidden", "idle"],
    [undefined, "idle"],
  ])("after a refusal with code %s the owl is %s", async (code, mood) => {
    box(playing([{ type: "error", code }]));
    ask("x");
    await screen.findByRole("alert");
    expect(owlOf()).toBe(mood);
  });
  it("the owl has a name and its mood as text for a screen reader, and 'Agent OWL' is what the box calls it", async () => {
    box(playing([]));
    expect(screen.getByRole("img", { name: "Agent OWL, Ready" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Your question for Agent OWL" })).toBeTruthy();
    cleanup();
    box(playing([]), "switched_off");
    expect(screen.getByRole("img", { name: "Agent OWL, Resting" })).toBeTruthy();
  });
  it("the owl answers while text arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transport: AskTransport = async function* () {
      yield { type: "text", delta: "First words." };
      await gate;
      yield { type: "done" };
    };
    box(transport);
    ask("x");
    await screen.findByText("First words.");
    expect(owlOf()).toBe("answering");
    release();
    await waitFor(() => expect(owlOf()).toBe("idle"));
  });
});

describe("AskTeam: touch and reading", () => {
  it("every control is at least 44px tall", () => {
    box(playing([]));
    for (const b of screen.getAllByRole("button")) expect(b.className, b.textContent ?? "").toMatch(/min-h-1[12]|size-12/);
    expect(screen.getByRole("textbox").className).toContain("min-h-12");
  });
  it("the input has a label a screen reader can find, and the answer area announces politely", async () => {
    box(playing([{ type: "text", delta: "Hi." }, { type: "done" }]));
    expect(screen.getByLabelText("Your question for Agent OWL")).toBe(screen.getByRole("textbox"));
    ask("x");
    await screen.findByText("Hi.");
    expect(screen.getByText("Hi.").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });
});

describe("AskTeam: the hero variant (the Agent OWL card of Today)", () => {
  const hero = (transport: AskTransport | null, onMood = vi.fn(), availability: "live" | "not_available" | "switched_off" = "live", chips?: string[]) => {
    const out = render(<AskTeam variant="hero" lang="en" base={B} words={WORDS} availability={availability} transport={transport} onMood={onMood} chips={chips} />);
    return { ...out, onMood };
  };
  it("is only the question line, the chips and the answer: no card, no heading, no owl of its own", () => {
    hero(playing([]));
    const root = document.querySelector('[data-ask="live"]')!;
    expect(root.tagName).toBe("DIV");
    expect(root.className).not.toContain("rounded-xl");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(root.querySelector('[role="img"]')).toBeNull();
  });
  it("the question line is 56 px on a laptop, round, with the hero placeholder, and the chips are the three given", () => {
    hero(playing([]), vi.fn(), "live", ["One?", "Two?", "Three?"]);
    const input = screen.getByRole("textbox", { name: "Your question for Agent OWL" });
    expect(input).toHaveAttribute("placeholder", "Ask anything, in any language…");
    expect(input.className).toContain("md:min-h-14");
    expect(input.className).toContain("rounded-full");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["One?", "Two?", "Three?"]);
    const send = screen.getByRole("button", { name: "Ask" });
    expect(send.className).toContain("md:size-14");
  });
  it("on a phone the chips are out of the way (the bar is fixed above the tab bar) and a chip asks its question", async () => {
    const seen: { question: string; lang: string; signal: AbortSignal }[] = [];
    hero(playing([{ type: "text", delta: "ok" }, { type: "done" }], seen), vi.fn(), "live", ["One?", "Two?", "Three?"]);
    expect(document.querySelector("ul")!.className).toContain("max-md:hidden");
    fireEvent.click(screen.getByRole("button", { name: "Two?" }));
    await waitFor(() => expect(seen[0]?.question).toBe("Two?"));
  });
  it("tells the card the mood as the question goes: idle, listening while typing, thinking, answering, and idle again after the answer", async () => {
    const hold: { first?: () => void; second?: () => void } = {};
    const slow: AskTransport = async function* () {
      await new Promise<void>((r) => (hold.first = r));
      yield { type: "text", delta: "Two quotes wait." };
      await new Promise<void>((r) => (hold.second = r));
      yield { type: "done" };
    };
    const { onMood } = hero(slow);
    expect(onMood).toHaveBeenLastCalledWith("idle");
    const input = screen.getByRole("textbox", { name: "Your question for Agent OWL" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "What needs me?" } });
    expect(onMood).toHaveBeenLastCalledWith("listening");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith("thinking"));
    await act(async () => hold.first?.());
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith("answering"));
    await act(async () => hold.second?.());
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith("idle"));
  });
  it("rests when the answer is refused for the cost, the switch or the limit", async () => {
    const { onMood } = hero(playing([{ type: "error", code: "ai_paused_until" }]));
    fireEvent.change(screen.getByRole("textbox", { name: "Your question for Agent OWL" }), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith("resting"));
  });
  it.each([
    ["not_available" as const, "Not available yet"],
    ["switched_off" as const, "Switched off"],
  ])("when %s it says so in a line and offers nothing to press", (availability, text) => {
    const { onMood } = hero(playing([]), vi.fn(), availability);
    expect(document.querySelector('[data-ask="unavailable"]')).toHaveTextContent(text);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onMood).toHaveBeenLastCalledWith("resting");
  });
});
