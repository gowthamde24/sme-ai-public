import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: nav.push }) }));
// the orb is a canvas: a plain stand-in here
vi.mock("@/components/v2/LazyAssistantOrb", () => ({ AssistantOrb: () => <span data-orb /> }));
// the lazy chunks are drawn at once in a unit test
vi.mock("./Lazy", async () => ({
  LiveStrip: (await import("./LiveStrip")).LiveStrip,
  PanelIslands: (await import("./PanelIslands")).PanelIslands,
  Repoll: () => <span data-repoll />,
}));
vi.mock("./LazyLive", async () => ({ LiveControls: (await import("./LiveControls")).LiveControls }));
vi.mock("../CallClient", () => ({
  EndCall: ({ end }: { end: () => Promise<unknown> }) => <button type="button" onClick={() => void end()}>End call</button>,
  TakeOver: ({ url }: { url: string }) => <button type="button" data-url={url}>Take over (you talk)</button>,
  Repoll: () => null,
}));

import { wordsFor } from "@/i18n/app-words";
import { parseCallDetail, parseCallRow, type CallRow } from "@/lib/api/calls";
import { parseTimeline } from "@/lib/api/customer-timeline";
import { callsHref, parseCallsQuery } from "@/lib/calls/filter";

import { CallPanel } from "./CallPanel";
import { CallsFilters } from "./CallsFilters";
import { CallsSearch } from "./CallsSearch";
import { CallsTable } from "./CallsTable";
import { CallsV6 } from "./CallsV6";
import { LiveControls } from "./LiveControls";
import { LiveStrip } from "./LiveStrip";
import { PanelIslands, Recording } from "./PanelIslands";

/** Design system v6: the Calls page and its pieces (search and chips, table, live strip, right panel). */
const W = wordsFor("en", ["calls6.", "ph.", "outcome.cat.", "outcome.result.", "dst.teach", "today.err."], ["dta.btn.working"]);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const Q = "44444444-4444-4444-8444-444444444444";
const id = (n: number) => `33333333-3333-4333-8333-3333333333${String(10 + n)}`;
const when = (iso: string) => iso.slice(5, 16).replace("T", " ");
const base = { direction: "inbound", state: "completed", live: false, who: "Lakshmi", language: "te", created_at: "2026-11-12T05:00:00Z", elapsed_s: 126, outcome: "positive", category: "visit_booked", summary_short: null, lead_id: L, sandbox: false, cost_paise: 450 };
const row = (n: number, over: Record<string, unknown> = {}): CallRow => parseCallRow({ ...base, id: id(n), ...over }) as CallRow;
const ROWS = [
  row(1, { live: true, state: "in_progress", answered_at: "2026-11-13T04:00:00Z", elapsed_s: 42, outcome: null, category: null, who: "Ravi Kumar", cost_paise: undefined }),
  row(2),
  row(3, { who: "Sita", state: "no_answer", outcome: null, category: null, elapsed_s: 0, cost_paise: 0 }),
  row(4, { who: "+91 98480 12345", state: "refused", refuse_reason: "outside_hours", outcome: null, category: null, elapsed_s: 0 }),
  row(5, { who: "Unknown caller", state: "refused", refuse_reason: "blocked_caller", outcome: null, category: null, elapsed_s: 0, direction: "outbound" }),
];
const NOW = Date.parse("2026-11-13T06:00:00Z");
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  nav.refresh.mockReset();
});

describe("the search, the chips and the dropdowns", () => {
  const q = parseCallsQuery({});
  const counts = { all: 5, completed: 1, transferred: 0, no_answer: 1, rejected: 1, spam: 1, live: 1 };
  it("a search box at the heading that asks for a name, a number or what they said, keeps the other filters, and is read to screen readers with its limit", () => {
    render(<CallsSearch words={W} base={BASE} query={parseCallsQuery({ status: "spam", when: "7d", line: "l1", q: "ravi" })} />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", `${BASE}/calls`);
    expect(within(form).getByPlaceholderText("Search name, number or what they said")).toHaveValue("ravi");
    expect([...form.querySelectorAll("input[type=hidden]")].map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`)).toEqual(["status=spam", "when=7d", "line=l1"]);
    expect(within(form).getByText(/exact words said on a call are not searched yet/)).toHaveClass("sr-only");
    expect(within(form).getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
  });
  it("seven chips with their counts, the current one marked, each a link that keeps the query", () => {
    render(<CallsFilters words={W} base={BASE} query={parseCallsQuery({ status: "no_answer", q: "sita" })} counts={counts} lines={[]} />);
    const nav7 = screen.getByRole("navigation", { name: "Filter calls by status" });
    const chips = [...nav7.querySelectorAll("a")];
    expect(chips.map((a) => a.textContent)).toEqual(["All5", "Completed1", "Transferred0", "No answer1", "Rejected1", "Spam1", "Live1"]);
    expect(chips.filter((a) => a.getAttribute("aria-current") === "true").map((a) => a.dataset.chip)).toEqual(["no_answer"]);
    expect(chips[1]).toHaveAttribute("href", `${BASE}/calls?status=completed&q=sita`);
    expect(chips[0]).toHaveAttribute("href", `${BASE}/calls?q=sita`);
    expect(nav7.querySelectorAll("[data-status]")).toHaveLength(6);
  });
  it("a date dropdown and a number dropdown (empty until the API labels the numbers)", () => {
    render(<CallsFilters words={W} base={BASE} query={q} counts={counts} lines={[]} />);
    const when7 = document.querySelector('[data-part="calls-when"]') as HTMLElement;
    expect(when7).toHaveTextContent("Any time");
    expect([...when7.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([`${BASE}/calls`, `${BASE}/calls?when=today`, `${BASE}/calls?when=7d`, `${BASE}/calls?when=30d`]);
    expect(document.querySelector('[data-part="calls-line"]')).toHaveTextContent("All numbers");
    expect(screen.getByText(/Your numbers are listed here/)).toBeInTheDocument();
    cleanup();
    render(<CallsFilters words={W} base={BASE} query={parseCallsQuery({ line: "l2" })} counts={counts} lines={[{ id: "l1", label: "Main ••••• 90129" }, { id: "l2", label: "Shop" }]} />);
    expect(document.querySelector('[data-part="calls-line"]')).toHaveTextContent("Shop");
    expect(document.querySelector('[data-part="calls-line"] a[aria-current="true"]')).toHaveAttribute("href", `${BASE}/calls?line=l2`);
  });
});

describe("the table", () => {
  it("has the six columns; each row: who and in/out, the outcome sentence, a status pill, length, cost in rupees, time", () => {
    render(<CallsTable words={W} base={BASE} query={parseCallsQuery({})} items={ROWS} selectedId={null} when={when} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Customer", "What happened", "Status", "Duration", "Cost", "Time"]);
    const r2 = document.querySelector(`[data-call="${id(2)}"]`) as HTMLElement;
    expect(within(r2).getByRole("link", { name: "Lakshmi" })).toHaveAttribute("href", `${BASE}/calls/${id(2)}`);
    expect(r2).toHaveTextContent("In");
    expect(r2).toHaveTextContent("Visit booked");
    expect(r2).toHaveTextContent("Completed");
    expect(r2).toHaveTextContent("2:06");
    expect(r2).toHaveTextContent("₹4.5");
    expect(r2).toHaveTextContent("11-12");
    expect(r2.querySelector('[data-status="completed"]')).not.toBeNull();
    const live = document.querySelector(`[data-call="${id(1)}"]`) as HTMLElement;
    expect(live.querySelector('[data-status="live"]')).toHaveTextContent("Live");
    expect(live).toHaveTextContent("0:42");
    expect(live).toHaveTextContent("—"); // no cost yet
  });
  it("says a no answer, a refusal with its reason, and a blocked caller as spam; an outgoing call says Out", () => {
    render(<CallsTable words={W} base={BASE} query={parseCallsQuery({})} items={ROWS} selectedId={null} when={when} />);
    expect(document.querySelector(`[data-call="${id(3)}"]`)).toHaveTextContent("No answer");
    expect(document.querySelector(`[data-call="${id(3)}"]`)).toHaveTextContent("₹0");
    expect(document.querySelector(`[data-call="${id(4)}"]`)).toHaveTextContent("Not called: outside the hours or days it may call.");
    expect(document.querySelector(`[data-call="${id(4)}"] [data-status="rejected"]`)).not.toBeNull();
    expect(document.querySelector(`[data-call="${id(5)}"] [data-status="spam"]`)).not.toBeNull();
    expect(document.querySelector(`[data-call="${id(5)}"]`)).toHaveTextContent("Out");
  });
  it("marks the open row, and its link keeps the filters", () => {
    render(<CallsTable words={W} base={BASE} query={parseCallsQuery({ status: "all", when: "7d" })} items={ROWS} selectedId={id(2)} when={when} />);
    expect(document.querySelector(`[data-call="${id(2)}"]`)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "Lakshmi" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Sita" })).toHaveAttribute("href", `${BASE}/calls/${id(3)}?when=7d`);
  });
  it("prefers the API's own sentence and status", () => {
    const r = row(6, { outcome_sentence: "Booked Saturday for 20 Kanchi sarees.", status: "transferred" });
    render(<CallsTable words={W} base={BASE} query={parseCallsQuery({})} items={[r]} selectedId={null} when={when} />);
    expect(screen.getByText("Booked Saturday for 20 Kanchi sarees.")).toBeInTheDocument();
    expect(document.querySelector('[data-status="transferred"]')).toHaveTextContent("Transferred");
  });
});

describe("the live strip", () => {
  it("the real circle, 'N live now', each caller as 'name · outbound · 0:42' with a timer that counts on, Listen and 'Open <first name>'", () => {
    vi.useFakeTimers();
    render(<LiveStrip words={W} calls={[{ id: id(1), who: "Ravi Kumar", direction: "outbound", elapsedS: 42, answered: true, href: `${BASE}/calls/${id(1)}` }, { id: id(2), who: "Sita", direction: "inbound", elapsedS: 0, answered: false, href: `${BASE}/calls/${id(2)}` }]} />);
    const strip = document.querySelector('[data-part="live-strip"]') as HTMLElement;
    expect(strip.querySelector("[data-orb]")).not.toBeNull();
    expect(within(strip).getByRole("status")).toHaveTextContent("2 live now");
    const first = strip.querySelector(`[data-live-call="${id(1)}"]`) as HTMLElement;
    expect(first).toHaveTextContent("Ravi Kumar · outbound · 0:42");
    expect(strip.querySelector(`[data-live-call="${id(2)}"]`)).toHaveTextContent("Sita · incoming · Ringing");
    expect(within(strip).getByRole("link", { name: "Open Ravi Kumar" })).toHaveAttribute("href", `${BASE}/calls/${id(1)}`);
    expect(within(strip).getByRole("link", { name: "Sita" })).toHaveAttribute("href", `${BASE}/calls/${id(2)}`);
    expect(within(strip).getByRole("button", { name: "Listen" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(first).toHaveTextContent("0:45");
  });
  it("Listen is a sample: it says so and plays nothing", () => {
    render(<LiveStrip words={W} calls={[{ id: id(1), who: "Ravi", direction: "inbound", elapsedS: 1, answered: true, href: "/x" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(screen.getByRole("button", { name: "Listening" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Listening is a sample here/)).toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });
  it("draws nothing when no call is live", () => {
    const { container } = render(<LiveStrip words={W} calls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const DETAIL = parseCallDetail({ ...base, id: id(2), summary: "Lakshmi wants 20 Kanchi silk sarees and will visit on Saturday.", captured: { visit_day: "Saturday" }, duration_s: 126, transcript: [{ who: "assistant", text: "Namaste! I am the AI assistant of Demo Silks.", t: 1, text_en: null }, { who: "caller", text: "అవును, కంచి పట్టు చీరలు కావాలి.", t: 5, text_en: "Yes, I want Kanchi silk sarees." }, { who: "assistant", text: "We open at 9.", t: 9 }], correction: null }, id(2));
const TL = parseTimeline({ items: [{ kind: "quote", at: "2026-11-12T06:00:00Z", text: "Quote 12", target: { type: "quote", id: Q }, detail: { status: "draft", total_paise: 4_500_000 } }] }).items;
const teach = () => ({ save: vi.fn(async () => ({ ok: true as const, id: "55555555-5555-4555-8555-555555555555" })), undo: vi.fn(async () => ({ ok: true as const })) });
const panel = (over: Partial<React.ComponentProps<typeof CallPanel>> = {}) => (
  <CallPanel words={W} base={BASE} query={parseCallsQuery({ status: "completed" })} call={DETAIL} timeline={TL} when={when} language="Telugu" canRead teach={teach()} approve={async () => ({ ok: true as const, message: "Approved. Nothing was sent. Open it in WhatsApp to send it yourself." })} liveControls={null} {...over} />
);

describe("the right panel of a finished call", () => {
  it("who, when, the status pill, what happened (the sentence, then the summary)", () => {
    render(panel());
    const p = document.querySelector('[data-part="call-panel"]') as HTMLElement;
    expect(within(p).getByRole("heading", { level: 2, name: "Lakshmi" })).toBeInTheDocument();
    expect(p.querySelector('[data-status="completed"]')).toHaveTextContent("Completed");
    const sum = p.querySelector('[data-part="call-summary"]') as HTMLElement;
    expect(sum).toHaveTextContent("Summary: Lakshmi wants 20 Kanchi silk sarees and will visit on Saturday.");
    expect(sum).toHaveTextContent("Visit booked");
    expect(p).toHaveTextContent("Telugu");
    expect(p).toHaveTextContent("2:06");
    expect(within(p).getByRole("link", { name: "All calls" })).toHaveAttribute("href", `${BASE}/calls?status=completed`);
  });
  it("the owner's correction comes first and is marked as theirs", () => {
    const corrected = parseCallDetail({ ...base, id: id(2), summary: "AI words.", captured: {}, transcript: null, correction: { summary: "Her words.", captured: {}, note: null, corrected_at: "2026-11-12T07:00:00Z" } }, id(2));
    render(panel({ call: corrected }));
    expect(document.querySelector('[data-part="call-summary"]')).toHaveTextContent("Her words.");
    expect(document.querySelector('[data-part="call-summary"]')).toHaveTextContent("You corrected this.");
  });
});

describe("the panel's lower part (outcome, recording, transcript, buttons)", () => {
  it("a quote waiting for the owner: Change and Approve; Approve says nothing was sent and then offers Open in WhatsApp", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } }); // (Approve & send then opens WhatsApp through the quote's own route)
    render(panel());
    const card = document.querySelector('[data-part="call-outcome"]') as HTMLElement;
    expect(card).toHaveTextContent("Quote");
    expect(card).toHaveTextContent("₹45,000");
    expect(within(card).getByRole("link", { name: "Change" })).toHaveAttribute("href", `${BASE}/quotes/${Q}`);
    expect(card).toHaveTextContent("Approving sends nothing");
    expect(card.querySelector("a[href*='whatsapp']")).toBeNull();
    await act(async () => void fireEvent.click(within(card).getByRole("button", { name: "Approve & send" })));
    expect(card.querySelector('[role="status"]')).toHaveTextContent("Approved. Nothing was sent.");
    expect(card).toHaveTextContent("Quote approved");
    expect(assign).toHaveBeenCalledWith(`${BASE}/quotes/${Q}/whatsapp`);
    expect(card.querySelector("[data-part='quote-whatsapp']")).toHaveAttribute("href", `${BASE}/quotes/${Q}/whatsapp`);
    expect(within(card).queryByRole("button", { name: "Approve & send" })).toBeNull();
  });
  it("a refused approval says why and, for the missing second factor, links to Security", async () => {
    render(panel({ approve: async () => ({ ok: false as const, error: "Set up your authenticator app first.", mfa: true }) }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve & send" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Set up your authenticator app first.");
    expect(screen.getByRole("link", { name: "Set up your security app" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("button", { name: "Approve & send" })).toBeInTheDocument(); // can try again
  });
  it("Sales cannot approve: there is no Approve button, the quote is still shown", () => {
    render(panel({ approve: null }));
    expect(screen.queryByRole("button", { name: "Approve & send" })).toBeNull();
    expect(document.querySelector('[data-part="call-outcome"]')).toHaveTextContent("₹45,000");
  });
  it("a booked visit and a call back are cards of their own", () => {
    render(panel({ timeline: [] }));
    expect(document.querySelector('[data-outcome="visit"]')).toHaveTextContent("Visit booked for Saturday");
    expect(within(document.querySelector('[data-outcome="visit"]') as HTMLElement).getByRole("link", { name: "Open visits" })).toHaveAttribute("href", `${BASE}/visits`);
    cleanup();
    render(panel({ timeline: [], call: parseCallDetail({ ...base, id: id(2), category: "call_back_later", captured: {}, transcript: [], correction: null }, id(2)) }));
    expect(document.querySelector('[data-outcome="callback"]')).toHaveTextContent("The caller asked to be called back");
  });
  it("the transcript has Teach this on EVERY assistant line (source call), none on the caller's", async () => {
    const t = teach();
    render(panel({ teach: t }));
    const tr = document.querySelector('[data-part="call-transcript"]') as HTMLElement;
    expect(tr.querySelectorAll('[data-who="assistant"]')).toHaveLength(2);
    expect(tr.querySelectorAll('[data-who="assistant"] [data-part="teach"]')).toHaveLength(2);
    expect(tr.querySelectorAll('[data-who="caller"] [data-part="teach"]')).toHaveLength(0);
    expect(tr).toHaveTextContent("Yes, I want Kanchi silk sarees."); // the English line under a line that is not English
    const lastTeach = tr.querySelectorAll('[data-who="assistant"] [data-part="teach"]')[1] as HTMLElement;
    fireEvent.click(within(lastTeach).getByRole("button", { name: /Teach this/ }));
    fireEvent.change(within(lastTeach).getByRole("textbox"), { target: { value: "We open at 10 am." } });
    await act(async () => void fireEvent.click(within(lastTeach).getByRole("button", { name: "Save to Knowledge" })));
    expect(t.save).toHaveBeenCalledWith({ source: "call", sourceId: id(2), lineIndex: 2, answer: "We open at 10 am." });
  });
  it("no Teach this for someone who may not teach; a Sales person is told the transcript is not theirs", () => {
    render(panel({ teach: null }));
    expect(document.querySelectorAll('[data-part="teach"]')).toHaveLength(0);
    cleanup();
    render(panel({ canRead: false, call: parseCallDetail({ ...base, id: id(2), transcript: null, correction: null }, id(2)) }));
    expect(screen.getByText(/Only the owner and admins read what is said/)).toBeInTheDocument();
  });
  it("the recording is a SAMPLE player that says nothing is recorded, and plays nothing", () => {
    vi.useFakeTimers();
    render(panel());
    const rec = document.querySelector('[data-part="call-recording"]') as HTMLElement;
    expect(rec).toHaveTextContent("Calls are not recorded today");
    expect(rec).toHaveTextContent("0:00 / 2:06");
    fireEvent.click(within(rec).getByRole("button", { name: "Play" }));
    act(() => void vi.advanceTimersByTime(3000));
    expect(rec).toHaveTextContent("0:03 / 2:06");
    fireEvent.click(within(rec).getByRole("button", { name: "Pause" }));
    expect(document.querySelector("audio")).toBeNull();
  });
  it("the recording stops and rewinds at the end", () => {
    vi.useFakeTimers();
    render(<Recording words={W} seconds={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => void vi.advanceTimersByTime(2500));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText("0:00 / 0:02")).toBeInTheDocument();
  });
  it("Call back only notes the wish (a sample); WhatsApp opens the customer's chat here, never a number; Open customer", () => {
    render(panel());
    const acts = document.querySelector('[data-part="call-actions"]') as HTMLElement;
    expect(within(acts).getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", `${BASE}/chats/${L}`);
    expect(within(acts).getByRole("link", { name: "Open customer" })).toHaveAttribute("href", `${BASE}/customers/${L}`);
    fireEvent.click(within(acts).getByRole("button", { name: "Call back" }));
    expect(acts).toHaveTextContent("nothing is called from here yet");
    expect(acts.innerHTML).not.toMatch(/wa\.me|tel:|\+91\d/);
  });
  it("a call with no customer has no customer buttons", () => {
    render(panel({ call: parseCallDetail({ ...base, id: id(2), lead_id: null, transcript: [], correction: null }, id(2)), timeline: null }));
    expect(screen.queryByRole("link", { name: "Open customer" })).toBeNull();
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
  });
});

describe("the live panel", () => {
  const LIVE = parseCallDetail({ ...base, who: "Ravi Kumar", id: id(1), live: true, state: "in_progress", answered_at: "2026-11-13T04:00:00Z", elapsed_s: 42, transcript: [{ who: "assistant", text: "Namaste!", t: 1 }, { who: "caller", text: "Hello", t: 3 }], correction: null, can_take_over: true, category: null, outcome: null }, id(1));
  const controls = (over = {}) => ({ whisper: vi.fn(async () => ({ ok: true as const })), end: vi.fn(async () => ({ ok: true as const })), takeOver: { url: "wss://example.test/take-over", tokenUrl: `${BASE}/calls/${id(1)}/take-over-token` }, ringing: false, ...over });
  it("the orb, the clock, what is being said, and Listen, Whisper, Take over, End; no Teach this, no recording", async () => {
    render(panel({ call: LIVE, timeline: null, liveControls: controls() }));
    const p = document.querySelector('[data-part="call-panel"]') as HTMLElement;
    expect(p).toHaveAttribute("data-live", "1");
    expect(p.querySelector("[data-orb]")).not.toBeNull();
    expect(p.querySelector('[data-part="call-clock"]')).toHaveTextContent("0:42");
    expect(p.querySelector('[data-status="live"]')).toHaveTextContent("Live");
    expect(p).toHaveTextContent("Being said now");
    const ctl = p.querySelector('[data-part="live-controls"]') as HTMLElement;
    expect(within(ctl).getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(within(ctl).getByRole("button", { name: "Take over (you talk)" })).toBeInTheDocument();
    expect(within(ctl).getByRole("button", { name: "End call" })).toBeInTheDocument();
    expect(within(ctl).getByLabelText("Whisper to your assistant")).toBeInTheDocument();
    expect(p.querySelectorAll('[data-part="teach"]')).toHaveLength(0);
    expect(p.querySelector('[data-part="call-recording"]')).toBeNull();
    expect(p.querySelector('[data-part="call-actions"]')).toBeNull();
  });
  it("Whisper sends the words through the action and says only the assistant hears it", async () => {
    const c = controls();
    render(<LiveControls words={W} {...c} />);
    fireEvent.change(screen.getByLabelText("Whisper to your assistant"), { target: { value: "  Offer the Saturday visit " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Whisper" })));
    expect(c.whisper).toHaveBeenCalledWith("Offer the Saturday visit");
    expect(screen.getByRole("status")).toHaveTextContent("Only your assistant hears it, not the caller.");
    expect(screen.getByLabelText("Whisper to your assistant")).toHaveValue("");
  });
  it("a refused whisper says so, and the button waits for words", async () => {
    const c = controls({ whisper: vi.fn(async () => ({ ok: false as const, error: "not_here" })) });
    render(<LiveControls words={W} {...c} />);
    expect(screen.getByRole("button", { name: "Whisper" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Whisper to your assistant"), { target: { value: "Hi" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Whisper" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not whisper");
  });
  it("a Sales person (or a call that is only ringing) gets no whisper, no take over, no end", () => {
    render(<LiveControls words={W} whisper={null} end={null} takeOver={null} ringing />);
    expect(screen.queryByLabelText("Whisper to your assistant")).toBeNull();
    expect(screen.queryByRole("button", { name: "End call" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Take over/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
  });
});

describe("the Calls page", () => {
  const props = (over: Partial<React.ComponentProps<typeof CallsV6>> = {}): React.ComponentProps<typeof CallsV6> => ({
    words: W, lang: "en", base: BASE, query: parseCallsQuery({}), calls: ROWS, now: NOW, olderHref: null, selectedId: null, phoneOpen: false, shortWhen: when, selected: null, when, language: "Telugu", canRead: true, teach: null, approve: null, liveControls: null,
    help: <i data-help />, testHref: `${BASE}/calls?test=1`, repoll: <b data-repoll />, ...over,
  });
  it("header, search, the live strip, chips with counts, the table, and a panel that says to pick a call", () => {
    render(<CallsV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Calls" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a test call" })).toHaveAttribute("href", `${BASE}/calls?test=1`);
    expect(document.querySelector('[data-part="live-strip"]')).toHaveTextContent("1 live now");
    expect(screen.getAllByRole("navigation", { name: "Filter calls by status" })).toHaveLength(1);
    expect(document.querySelector('[data-chip="all"]')).toHaveTextContent("5");
    expect(document.querySelector('[data-chip="completed"]')).toHaveTextContent("1");
    expect(document.querySelector('[data-chip="rejected"]')).toHaveTextContent("1");
    expect(document.querySelectorAll('[data-part="calls-table"] tbody tr')).toHaveLength(5);
    expect(document.querySelector('[data-part="call-panel-empty"]')).toHaveTextContent("Pick a call to read it here.");
    expect(document.querySelector("[data-help]")).not.toBeNull();
    expect(document.querySelector("[data-repoll]")).not.toBeNull();
  });
  it("a chip shows only that status, the counts follow the date and the search", () => {
    render(<CallsV6 {...props({ query: parseCallsQuery({ status: "no_answer" }) })} />);
    expect(document.querySelectorAll('[data-part="calls-table"] tbody tr')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Sita" })).toBeInTheDocument();
    cleanup();
    render(<CallsV6 {...props({ query: parseCallsQuery({ q: "lakshmi" }) })} />);
    expect(document.querySelector('[data-chip="all"]')).toHaveTextContent("1");
    expect(document.querySelector('[data-chip="no_answer"]')).toHaveTextContent("0");
  });
  it("a search that matches nothing says so and offers to clear the filters", () => {
    render(<CallsV6 {...props({ query: parseCallsQuery({ q: "zzzz" }) })} />);
    expect(document.querySelector('[data-part="calls-none"]')).toHaveTextContent("No calls match");
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", `${BASE}/calls`);
    expect(document.querySelector('[data-part="calls-table"]')).toBeNull();
  });
  it("no calls at all: the empty page shows its next step", () => {
    render(<CallsV6 {...props({ calls: [] })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toHaveTextContent("No calls yet");
    expect(screen.getByRole("link", { name: "Make a test call" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="calls-table"]')).toBeNull();
    cleanup();
    render(<CallsV6 {...props({ calls: [], testHref: null })} />);
    expect(screen.getByRole("link", { name: "Make a test call" })).toHaveAttribute("href", `${BASE}/my-assistant`); // Sales and Admin: practise from My assistant
  });
  it("a list that could not be read says so; the page still has its header", () => {
    render(<CallsV6 {...props({ calls: null })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The calls could not be read just now.");
    expect(screen.getByRole("heading", { level: 1, name: "Calls" })).toBeInTheDocument();
  });
  it("an open call fills the panel; on a phone the list gives way to it", () => {
    render(<CallsV6 {...props({ selectedId: id(2), phoneOpen: true, selected: { call: DETAIL, timeline: TL }, teach: teach(), approve: async () => ({ ok: true as const, message: "ok" }) })} />);
    expect(document.querySelector('[data-part="call-panel"]')).toHaveTextContent("Lakshmi");
    expect(document.querySelector('[data-part="calls-table"]')?.parentElement).toHaveClass("hidden", "lg:flex");
    expect(document.querySelector('[data-part="call-panel-empty"]')).toBeNull();
  });
  it("an open call that cannot be read says so and links back", () => {
    render(<CallsV6 {...props({ selectedId: id(2), phoneOpen: true, selected: { call: null, timeline: null } })} />);
    expect(document.querySelector('[data-part="call-panel-missing"]')).toHaveTextContent("This call could not be read right now.");
    expect(within(document.querySelector('[data-part="call-panel-missing"]') as HTMLElement).getByRole("link", { name: "All calls" })).toHaveAttribute("href", `${BASE}/calls`);
  });
  it("'Older' follows the API's cursor", () => {
    render(<CallsV6 {...props({ olderHref: `${BASE}/calls?cursor=2026-11-01T00%3A00%3A00Z` })} />);
    expect(screen.getByRole("link", { name: "Older calls" })).toHaveAttribute("href", `${BASE}/calls?cursor=2026-11-01T00%3A00%3A00Z`);
  });
  it("shows no phone number or wa.me link anywhere in the markup it builds", () => {
    render(<CallsV6 {...props({ selectedId: id(2), phoneOpen: true, selected: { call: DETAIL, timeline: TL } })} />);
    expect(document.body.innerHTML).not.toMatch(/wa\.me|href="tel:/);
  });
});

describe("callsHref", () => {
  it("keeps a call and the query together", () => {
    expect(callsHref(BASE, parseCallsQuery({ status: "spam" }), id(1))).toBe(`${BASE}/calls/${id(1)}?status=spam`);
  });
});

void waitFor;
