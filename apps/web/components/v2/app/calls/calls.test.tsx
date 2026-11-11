import type * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: nav.push }) }));
// the orb is a canvas: a plain stand-in here
vi.mock("@/components/v2/LazyAssistantOrb", () => ({ AssistantOrb: () => <span data-orb /> }));

import { wordsFor } from "@/i18n/app-words";
import { parseCallDetail, parseCallsPage } from "@/lib/api/calls";
import { stagesDone } from "@/lib/calls/view";

import { CorrectIt, EndCall, EnglishLines, Repoll, TakeOver } from "./CallClient";
import { CallsList } from "./CallsList";
import { CallView } from "./CallView";
import { TestCallForm } from "./TestCallForm";

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
      { ...ROW, id: LIVE, live: true, state: "in_progress", elapsed_s: 4, answered_at: "2026-11-06T05:00:05Z", outcome: null, category: null, summary_short: null },
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
  it('a caller with no name: "What the caller wants" and "Where the caller is now"; the API\'s own words in the heading and as the speaker (owner, 7 Nov)', () => {
    render(<CallView call={detail({ who: "Caller ending 998", live: true, state: "in_progress" })} base={BASE} w={W} when={when} language="Telugu" stages={stagesDone(["arrival"], true)} canRead end={null} correct={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Caller ending 998" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What the caller wants" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where the caller is now" })).toBeInTheDocument();
    expect(screen.queryByText(/What Caller ending/)).toBeNull();
    expect(document.querySelector('[data-who="caller"] > span')?.textContent).toBe("Caller ending 998");
    cleanup();
    render(<CallView call={detail({ who: "New enquiry" })} base={BASE} w={W} when={when} language={null} stages={null} canRead end={null} correct={null} />);
    expect(screen.getByRole("heading", { name: "What the caller wants" })).toBeInTheDocument();
    expect(screen.queryByText(/What New enquiry/)).toBeNull();
    cleanup();
    render(<CallView call={detail({ who: "Lakshmi" })} base={BASE} w={W} when={when} language={null} stages={null} canRead end={null} correct={null} />);
    expect(screen.getByRole("heading", { name: "What Lakshmi wants" })).toBeInTheDocument();
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
  it("End call on a call that still rings, when the API says it is not on this server: it says it cannot be ended yet and ends by itself; an answered call keeps the old sentence", async () => {
    const end = vi.fn().mockResolvedValue({ ok: false, error: "not_here" });
    render(<EndCall w={W} end={end} ringing />);
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The call is still ringing and cannot be ended yet. It will end by itself."));
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(<EndCall w={W} end={end} />);
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end it" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That didn't reach the call."));
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

describe("Place a test call (job test-call)", () => {
  const TW = wordsFor("en", ["tc.", "tt.intro."]);
  const LANGS = [{ code: "en", label: "English" }, { code: "te", label: "Telugu" }, { code: "kn", label: "Kannada" }, { code: "hi", label: "Hindi" }] as const;
  const GOAL = "Ask if they would like to visit the shop on Saturday to see the new silk sarees.";
  const NUMBERS = [{ id: "a1b2c3d4e5f60718", masked: "+91 ••••• 90129", label: null }, { id: "fedcba9876543210", masked: "+91 ••••• 22338", label: "Owner's phone" }];
  const fill = (id: string, goal: string) => {
    fireEvent.change(screen.getByLabelText(TW["tc.to"]), { target: { value: id } });
    fireEvent.change(screen.getByLabelText(TW["tc.goal"]), { target: { value: goal } });
  };
  const ID = NUMBERS[0].id;
  it("says what is wrong with the goal as it is typed, and will not go to the second step", () => {
    const place = vi.fn();
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    fill(ID, "Ring me on 98480 22338");
    expect(screen.getByText(TW["tc.goal.number"])).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.queryByText(TW["tc.sure.title"])).toBeNull();
    fill(ID, "Mail owner@example.in about it please");
    expect(screen.getByText(TW["tc.goal.email"])).toBeTruthy();
    fill(ID, "See https://example.in for the sarees");
    expect(screen.getByText(TW["tc.goal.link"])).toBeTruthy();
    fill(ID, "First line about silk\nsecond line about cotton");
    expect(screen.getByText(TW["tc.goal.line"])).toBeTruthy();
    fill(ID, "short");
    expect(screen.getByText(TW["tc.goal.short"])).toBeTruthy();
    fill(ID, "x".repeat(401));
    expect(screen.getByText(TW["tc.goal.long"])).toBeTruthy();
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.getByText(TW["tc.sure.title"])).toBeTruthy(); // a good goal goes on to the second step
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.no"] }));
    fill(ID, "Ring me on 98480 22338");
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(place).not.toHaveBeenCalled();
  });
  it("asks once more in plain words, and only then places the call; a placed call opens the status page", async () => {
    const place = vi.fn(async () => ({ ok: true as const, callId: C }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    fill(ID, GOAL);
    fireEvent.change(screen.getByLabelText(TW["tc.language"]), { target: { value: "te" } });
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.getByText(TW["tc.sure.title"])).toBeTruthy();
    expect(screen.getByText("+91 ••••• 90129")).toBeTruthy(); // the masked entry, never a full number
    expect(screen.getByText("Telugu")).toBeTruthy();
    expect(place).not.toHaveBeenCalled(); // nothing is sent by the first step
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`${BASE}/calls?test=1&call=${C}`));
    expect(place).toHaveBeenCalledWith({ toId: ID, language: "te", goal: GOAL });
  });
  it("the line check: no goal and no language to fill in, the second step says so, and it sends no goal in English; the other mode keeps its goal required", async () => {
    const place = vi.fn(async () => ({ ok: true as const, callId: C }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] })); // the default mode asks for a goal: nothing happens without one
    expect(screen.queryByText(TW["tc.sure.title"])).toBeNull();
    expect(screen.getByText(TW["tc.goal.short"])).toBeTruthy();
    fireEvent.change(screen.getByLabelText(TW["tc.language"]), { target: { value: "te" } });
    fireEvent.click(screen.getByLabelText(new RegExp(TW["tc.mode.line"])));
    expect(screen.queryByLabelText(TW["tc.goal"])).toBeNull();
    expect(screen.queryByLabelText(TW["tc.language"])).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.getByText(TW["tc.sure.title"])).toBeTruthy(); // the warning is the same
    expect(screen.getByText(TW["tc.sure.body.line"])).toBeTruthy();
    expect(screen.getByText(TW["tc.line.review"])).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`${BASE}/calls?test=1&call=${C}`));
    expect(place).toHaveBeenCalledWith({ toId: NUMBERS[0].id, language: "en", goal: null });
  });
  it("Introduce as for this call (C1, 11 Nov): offered only where the API has the field, only for a call about something; the saved setting is the default, a choice is checked as it is typed, shown in the second step and sent", async () => {
    const place = vi.fn(async () => ({ ok: true as const, callId: C }));
    const { unmount } = render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    expect(screen.queryByLabelText(TW["tc.intro.label"])).toBeNull(); // an API without the field: nothing is offered or sent
    unmount();
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} introduce={{ saved: { kind: "business", text: null }, business: "Lakshmi Silks" }} />);
    const sel = screen.getByLabelText(TW["tc.intro.label"]) as HTMLSelectElement;
    expect(sel.value).toBe("saved");
    expect(document.querySelector("[data-part=test-call-introduce-preview]")).toHaveTextContent("Hello, this is the AI assistant of Lakshmi Silks.");
    fireEvent.change(sel, { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText(TW["tt.intro.name"]), { target: { value: "Gowtham 2" } });
    expect(document.querySelector("[data-part=test-call-introduce-msg]")).toHaveTextContent("Take out the numbers.");
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.queryByText(TW["tc.sure.title"])).toBeNull(); // a bad name keeps it on the form
    fireEvent.change(screen.getByLabelText(TW["tt.intro.name"]), { target: { value: "Gowtham" } });
    expect(document.querySelector("[data-part=test-call-introduce-preview]")).toHaveTextContent("Hello, this is Gowtham's AI assistant.");
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.getByText(TW["tc.intro.review"])).toBeInTheDocument();
    expect(screen.getByText("Hello, this is Gowtham's AI assistant.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(place).toHaveBeenCalledWith({ toId: ID, language: "en", goal: GOAL, introduceAs: { kind: "owner", text: "Gowtham" } }));
    // the saved setting sends nothing of its own
    cleanup();
    const place2 = vi.fn(async () => ({ ok: true as const, callId: C }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place2} introduce={{ saved: { kind: "owner", text: "Gowtham" }, business: null }} />);
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(place2).toHaveBeenCalledWith({ toId: ID, language: "en", goal: GOAL }));
  });
  it("Tone (owner, 11 Nov): not offered until the switch is on; then Respectful, Friendly (the usual) and Casual, shown in the second step and sent; not for the line check", async () => {
    const place = vi.fn(async () => ({ ok: true as const, callId: C }));
    const { unmount } = render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    expect(screen.queryByLabelText(TW["tc.tone.label"])).toBeNull();
    unmount();
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} tone />);
    const sel = screen.getByLabelText(TW["tc.tone.label"]) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Respectful", "Friendly (the usual)", "Casual"]);
    expect(sel.value).toBe("friendly");
    expect(screen.getByText(/only for your own test calls, never for customers/)).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: "casual" } });
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    expect(screen.getByText(TW["tc.tone.review"])).toBeInTheDocument();
    expect(screen.getByText("Casual", { selector: "dd" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(place).toHaveBeenCalledWith({ toId: ID, language: "en", goal: GOAL, tone: "casual" }));
    cleanup();
    const p2 = vi.fn(async () => ({ ok: true as const, callId: C }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={p2} tone />);
    fireEvent.click(screen.getByLabelText(new RegExp(TW["tc.mode.line"])));
    expect(screen.queryByLabelText(TW["tc.tone.label"])).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    await waitFor(() => expect(p2).toHaveBeenCalledWith({ toId: NUMBERS[0].id, language: "en", goal: null }));
  });
  it("the line check has no Introduce as (its opening is fixed); a refusal for it says so in words", async () => {
    const place = vi.fn(async () => ({ ok: false as const, error: "introduce", problem: "human" }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} introduce={{ saved: { kind: "business", text: null }, business: "Lakshmi Silks" }} />);
    fireEvent.click(screen.getByLabelText(new RegExp(TW["tc.mode.line"])));
    expect(screen.queryByLabelText(TW["tc.intro.label"])).toBeNull();
    fireEvent.click(screen.getByLabelText(new RegExp(TW["tc.mode.goal"])));
    fireEvent.change(screen.getByLabelText(TW["tc.intro.label"]), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText(TW["tt.intro.words"]), { target: { value: "Gowtham's AI assistant" } });
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    expect(await screen.findByText("Never say human or person: it must be clear this is an AI.")).toBeInTheDocument();
    expect(screen.queryByText(TW["tc.sure.title"])).toBeNull();
  });
  it("Go back keeps what was typed; a refusal is said in plain words with the gate's own reason", async () => {
    const place = vi.fn(async () => ({ ok: false as const, error: "refused", reason: "outside_window" }));
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={place} />);
    fill(ID, GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.no"] }));
    expect((screen.getByLabelText(TW["tc.goal"]) as HTMLTextAreaElement).value).toBe(GOAL);
    fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
    fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
    expect(await screen.findByText(TW["tc.no.title"])).toBeTruthy();
    expect(screen.getByText(TW["tc.no.outside_window"])).toBeTruthy();
    expect(screen.queryByText(TW["tc.sure.title"])).toBeNull(); // back on the form, not stuck on the second step
    expect(nav.push).not.toHaveBeenCalledWith(expect.stringContaining("call="));
  });
  it("lists the masked phones and nothing typed: a full number is never an option", () => {
    render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={vi.fn()} />);
    const options = [...screen.getByLabelText(TW["tc.to"]).querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["+91 ••••• 90129", "Owner's phone +91 ••••• 22338"]);
    expect(document.querySelector('input[type="tel"]')).toBeNull();
  });
  it("a word it does not know, a provider failure and a failure without a word each have a calm sentence", async () => {
    const results = [{ ok: false as const, error: "refused", reason: "made_up" }, { ok: false as const, error: "provider" }, { ok: false as const, error: "off" }, { ok: false as const, error: "invalid" }, { ok: false as const, error: "down" }];
    const wants = [TW["tc.no.other"], TW["tc.err.provider"], TW["tc.err.off"], TW["tc.err.invalid"], TW["tc.err.down"]];
    for (const [i, res] of results.entries()) {
      cleanup();
      render(<TestCallForm w={TW} base={BASE} numbers={NUMBERS} languages={LANGS} place={async () => res} />);
      fill(ID, GOAL);
      fireEvent.click(screen.getByRole("button", { name: TW["tc.check"] }));
      fireEvent.click(screen.getByRole("button", { name: TW["tc.sure.yes"] }));
      expect(await screen.findByText(wants[i])).toBeTruthy();
      if (i === 0) expect(screen.getByText(TW["tc.no.code"].replace("{word}", "made_up"))).toBeTruthy(); // an unknown word is shown, so the owner can say it
    }
  });
});


describe("a call that is still RINGING (11 Nov 2026)", () => {
  const ringing = parseCallsPage({ items: [{ ...ROW, id: LIVE, live: true, state: "ringing", elapsed_s: 0, answered_at: null, outcome: null, category: null, summary_short: null, who: "Test call" }] }).items;
  it("the list says Ringing and shows no seconds until the call is answered", () => {
    render(<CallsList items={ringing} base={BASE} w={W} when={when} language={() => "Telugu"} olderHref={null} />);
    const live = screen.getByRole("region", { name: "Live now" });
    expect(live).toHaveTextContent("Ringing");
    expect(live).not.toHaveTextContent(/\d\d:\d\d/);
    expect(within(live).getByRole("link", { name: "Test call" })).toBeInTheDocument();
  });
  const base = { ...ROW, id: LIVE, live: true, outcome: null, category: null, who: "Test call", summary: null, captured: null, transcript: [{ who: "assistant", text: "Hello! I am the AI assistant.", t: 1 }] };
  const view = (call: ReturnType<typeof parseCallDetail>) => <CallView call={call} base={BASE} w={W} when={when} language="Telugu" canRead stages={stagesDone(["arrival"], true)} end={null} correct={null} />;
  it("the call page shows the word Ringing in the orb, no clock; once answered the clock is there", () => {
    const { container, rerender } = render(view(parseCallDetail({ ...base, state: "ringing", elapsed_s: 0, answered_at: null }, LIVE)));
    expect(container.querySelector("[data-part=call-ringing]")).toHaveTextContent("Ringing");
    expect(container.querySelector("[data-part=call-clock]")).toBeNull();
    rerender(view(parseCallDetail({ ...base, state: "in_progress", elapsed_s: 7, answered_at: "2026-11-11T10:00:18Z" }, LIVE)));
    expect(container.querySelector("[data-part=call-ringing]")).toBeNull();
    expect(container.querySelector("[data-part=call-clock]")).toHaveTextContent("00:07");
  });
});
