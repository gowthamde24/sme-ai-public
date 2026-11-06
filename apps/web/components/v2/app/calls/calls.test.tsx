import type * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
// the orb is a canvas: a plain stand-in here
vi.mock("@/components/v2/LazyAssistantOrb", () => ({ AssistantOrb: () => <span data-orb /> }));

import { wordsFor } from "@/i18n/app-words";
import { parseCallDetail, parseCallsPage } from "@/lib/api/calls";
import { stagesDone } from "@/lib/calls/view";

import { CorrectIt, EndCall, EnglishLines, Repoll, TakeOver } from "./CallClient";
import { CallsList } from "./CallsList";
import { CallView } from "./CallView";

/** app v4 part 4: the Calls list, one call (live and finished), End call, Correct it and the re-read while live. */
const W = wordsFor("en", ["ph.", "outcome.cat.", "outcome.result."]);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const LIVE = "55555555-5555-4555-8555-555555555555";
const REF = "66666666-6666-4666-8666-666666666666";
const L = "22222222-2222-4222-8222-222222222222";
const ROW = { id: C, direction: "inbound", state: "completed", live: false, who: "Lakshmi", language: "te", created_at: "2026-11-06T05:00:00Z", elapsed_s: 126, outcome: "positive", category: "visit_booked", summary_short: "Wants a red Kanchi silk, visiting Saturday", lead_id: L, sandbox: true };
const when = (iso: string) => iso.slice(0, 16);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Calls > Phone calls", () => {
  const items = parseCallsPage({
    items: [
      { ...ROW, id: LIVE, live: true, state: "in_progress", elapsed_s: 4, outcome: null, category: null, summary_short: null },
      ROW,
      { ...ROW, id: REF, state: "refused", refuse_reason: "outside_hours", outcome: null, category: null, summary_short: null, lead_id: null, elapsed_s: 0, sandbox: false },
    ],
  }).items;
  it("live calls first, each row opens its call; a customer's call links to the customer page; a refusal says why", () => {
    render(<CallsList items={items} base={BASE} w={W} when={when} language={() => "Telugu"} olderHref={null} />);
    const live = screen.getByRole("region", { name: "Live now" });
    expect(within(live).getByRole("link", { name: "Lakshmi" })).toHaveAttribute("href", `${BASE}/calls/${LIVE}`);
    expect(live).toHaveTextContent("On the call · 00:04");
    const earlier = screen.getByRole("region", { name: "Earlier calls" });
    expect(earlier).toHaveTextContent("Visit booked");
    expect(earlier).toHaveTextContent("Wants a red Kanchi silk, visiting Saturday");
    expect(earlier).toHaveTextContent("Not called: outside the hours or days it may call.");
    expect(within(earlier).getAllByRole("link", { name: "Customer page" })[0]).toHaveAttribute("href", `${BASE}/customers/${L}`);
    expect(document.querySelectorAll(`[data-call="${REF}"] [data-part="call-customer"]`)).toHaveLength(0);
    expect(screen.getAllByText("Test call")).toHaveLength(2);
  });
  it("says when there are none, or when the list could not be read", () => {
    render(<CallsList items={[]} base={BASE} w={W} when={when} language={() => null} olderHref={null} />);
    expect(screen.getByText("No calls yet.")).toBeInTheDocument();
    cleanup();
    render(<CallsList items={null} base={BASE} w={W} when={when} language={() => null} olderHref={null} />);
    expect(screen.getByText("The calls could not be read just now.")).toBeInTheDocument();
  });
});

describe("one call", () => {
  const detail = (over: Record<string, unknown> = {}) => parseCallDetail({ ...ROW, summary: "Lakshmi wants a red Kanchi silk saree for a wedding.", captured: { saree: "Kanchi silk", visit_day: "Saturday" }, transcript: [{ who: "assistant", text: "Hello! I am the AI assistant.", t: 1 }, { who: "caller", text: "అవును, పెళ్లి కోసం కంచి పట్టు చీర కావాలి.", t: 4 }], correction: null, ...over }, C);
  it("live: the newest line biggest and whole, in its own language; what they want; where they are; no Listen, Whisper or Take over", () => {
    render(<CallView call={detail({ live: true, state: "in_progress", elapsed_s: 4 })} base={BASE} w={W} when={when} language="Telugu" canRead stages={stagesDone(["arrival"], true)} end={<button type="button">End call</button>} correct={null} />);
    const lines = document.querySelectorAll('[data-part="call-captions"] li');
    expect(lines).toHaveLength(2);
    expect(lines[1].querySelector("span[lang]")).toHaveAttribute("lang", "te");
    expect(lines[1]).toHaveTextContent("అవును, పెళ్లి కోసం కంచి పట్టు చీర కావాలి.");
    expect(screen.getByRole("heading", { name: "What Lakshmi wants" }).parentElement).toHaveTextContent("Visit daySaturday");
    expect(Array.from(document.querySelectorAll("[data-stage]")).map((s) => `${s.getAttribute("data-stage")}:${s.getAttribute("data-done")}`)).toEqual(["enquiry:1", "call:1", "quote:0", "visit:0", "follow_up:0", "order:0"]);
    for (const word of [/listen/i, /whisper/i, /take over/i, /transfer/i]) expect(screen.queryByRole("button", { name: word })).toBeNull();
    expect(document.querySelector('[data-part="call-summary"]')).toBeNull();
  });
  it("finished: the correction first with the assistant's words beside it, the note, the transcript; Sales reads no transcript", () => {
    render(<CallView call={detail({ correction: { summary: "Wants two sarees.", captured: { visit_day: "Sunday" }, note: "Kanchi pattu means Kanchipuram silk", corrected_at: "2026-11-06T06:00:00Z" } })} base={BASE} w={W} when={when} language="Telugu" canRead stages={null} end={null} correct={<span data-correct />} />);
    const summary = document.querySelector('[data-part="call-summary"]')!;
    expect(summary).toHaveTextContent("Wants two sarees.");
    expect(summary).toHaveTextContent("You corrected this.");
    expect(summary).toHaveTextContent("The assistant wrote: Lakshmi wants a red Kanchi silk saree for a wedding.");
    expect(summary).toHaveTextContent("Kanchi pattu means Kanchipuram silk");
    expect(screen.getByRole("heading", { name: "What Lakshmi wants" }).parentElement).toHaveTextContent("Visit daySunday"); // the correction wins
    expect(document.querySelector('[data-part="call-transcript"]')).not.toBeNull();
    expect(document.querySelector('[data-part="call-where"]')).toBeNull();
    cleanup();
    render(<CallView call={detail({ transcript: null, live: true, state: "in_progress" })} base={BASE} w={W} when={when} language={null} stages={null} end={null} correct={null} canRead={false} />);
    expect(screen.getByText("Only the owner and admins read what is said on a call.")).toBeInTheDocument();
    cleanup();
    // an Owner whose request reached another server: no lines yet (C1 #405), never "not yours"
    render(<CallView call={detail({ transcript: null, live: true, state: "in_progress" })} base={BASE} w={W} when={when} language={null} stages={null} end={null} correct={null} canRead />);
    expect(screen.getByText("Nothing said yet.")).toBeInTheDocument();
  });
});

describe("Show English (owner, 7 Nov 2026)", () => {
  const withEnglish = (over: Record<string, unknown> = {}) =>
    parseCallDetail({ ...ROW, live: true, state: "in_progress", captured: {}, transcript: [{ who: "assistant", text: "నమస్తే! నేను AI అసిస్టెంట్‌ని.", t: 1, text_en: "Namaste! I am the AI assistant." }, { who: "caller", text: "అవును, పెళ్లి కోసం కంచి పట్టు చీర కావాలి.", t: 4, text_en: "Yes, I need a Kanchi silk saree for a wedding." }], correction: null, ...over }, C);
  const english = (userId: string) =>
    function WithEnglish(has: boolean, lines: React.ReactNode) {
      return (
        <EnglishLines userId={userId} label="Show English" has={has}>
          {lines}
        </EnglishLines>
      );
    };
  afterEach(() => window.localStorage.clear());
  it("the English line sits under each line that is not English, on by default; the switch is remembered for this person", () => {
    render(<CallView call={withEnglish()} base={BASE} w={W} when={when} language="Telugu" canRead stages={null} end={null} correct={null} english={english("u1")} />);
    const lines = document.querySelectorAll('[data-part="call-captions"] li');
    expect(lines[1].querySelector("[data-en]")).toHaveTextContent("Yes, I need a Kanchi silk saree for a wedding.");
    expect(lines[1].querySelector("[data-en]")).toHaveAttribute("lang", "en");
    expect(lines[0].querySelector("[data-en]")).toHaveTextContent("Namaste! I am the AI assistant.");
    const sw = screen.getByRole("switch", { name: "Show English" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector("[data-show-en]")).toHaveAttribute("data-show-en", "on");
    fireEvent.click(sw);
    expect(document.querySelector("[data-show-en]")).toHaveAttribute("data-show-en", "off");
    expect(window.localStorage.getItem("sme.calls.showEnglish.u1")).toBe("0");
    cleanup();
    // the same person again: still off; another person: on
    render(<CallView call={withEnglish()} base={BASE} w={W} when={when} language="Telugu" canRead stages={null} end={null} correct={null} english={english("u1")} />);
    expect(screen.getByRole("switch", { name: "Show English" })).toHaveAttribute("aria-checked", "false");
    cleanup();
    render(<CallView call={withEnglish()} base={BASE} w={W} when={when} language="Telugu" canRead stages={null} end={null} correct={null} english={english("u2")} />);
    expect(screen.getByRole("switch", { name: "Show English" })).toHaveAttribute("aria-checked", "true");
  });
  it("no English line anywhere: no switch", () => {
    render(<CallView call={withEnglish({ transcript: [{ who: "caller", text: "Yes, Saturday.", t: 1, text_en: null }] })} base={BASE} w={W} when={when} language={null} canRead stages={null} end={null} correct={null} english={english("u1")} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(document.querySelector("[data-en]")).toBeNull();
  });
});

describe("the call's moves", () => {
  it("Take over: you talk while the assistant is quiet, then hand back; a refused microphone says so", async () => {
    const sent: unknown[] = [];
    const socket = { binaryType: "", readyState: 0, send: (d: unknown) => void sent.push(d), close: vi.fn(), onopen: null as null | (() => void), onmessage: null as null | ((e: { data: unknown }) => void), onclose: null, onerror: null };
    const audio = { startMic: vi.fn(async () => undefined), stopMic: vi.fn(), play: vi.fn(), flush: vi.fn(), playing: () => false, close: vi.fn(), analyser: () => null };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TakeOver w={W} url="wss://api/x" tokenUrl="/t" audioFactory={() => audio} socketFactory={() => socket as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over (you talk)" }));
    await waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.readyState = 1;
    act(() => socket.onopen?.());
    act(() => socket.onmessage?.({ data: JSON.stringify({ type: "ready" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("You're on the call. Your assistant is quiet while you talk.");
    fireEvent.click(screen.getByRole("button", { name: "Hand back to the assistant" }));
    expect(sent.at(-1)).toBe(JSON.stringify({ type: "hand_back" }));
    expect(screen.getByRole("status")).toHaveTextContent("Your assistant has the call again.");
    cleanup();
    const denied = { ...audio, startMic: vi.fn(async () => Promise.reject(new Error("no"))) };
    render(<TakeOver w={W} url="wss://api/x" tokenUrl="/t" audioFactory={() => denied} socketFactory={() => socket as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Take over (you talk)" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your microphone is blocked."));
    vi.unstubAllGlobals();
  });
  it("End call asks twice, then says it is ending; a refusal says so", async () => {
    const end = vi.fn().mockResolvedValueOnce({ ok: false, error: "not_here" }).mockResolvedValueOnce({ ok: true });
    render(<EndCall w={W} end={end} />);
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, end it" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That didn't reach the call."));
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ending the call…"));
    expect(end).toHaveBeenCalledTimes(2);
  });
  it("Correct it sends only what changed, says a refusal in words, and reads the call again after a save", async () => {
    const correct = vi.fn().mockResolvedValueOnce({ ok: false, error: "contact" }).mockResolvedValueOnce({ ok: true, data: {} });
    render(<CorrectIt w={W} start={{ summary: "Wants a red saree.", captured: { visit_day: "Saturday" }, note: "" }} labels={{ visit_day: "Visit day" }} correct={correct} />);
    fireEvent.click(screen.getByRole("button", { name: "Correct it" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Change something first.");
    expect(correct).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Visit day"), { target: { value: "Sunday" } });
    fireEvent.change(screen.getByLabelText("Anything your assistant should know for next time"), { target: { value: "Call me on 98480 22338" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please take the phone number or e-mail address out of the note."));
    expect(correct).toHaveBeenLastCalledWith({ captured: { visit_day: "Sunday" }, note: "Call me on 98480 22338" });
    fireEvent.change(screen.getByLabelText("Anything your assistant should know for next time"), { target: { value: "Kanchi pattu means Kanchipuram silk" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save the correction" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("re-reads the page every few seconds, only while the tab is in view", () => {
    vi.useFakeTimers();
    nav.refresh.mockClear();
    render(<Repoll seconds={5} />);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    vis.mockRestore();
  });
});
