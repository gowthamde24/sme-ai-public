import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const polled = vi.hoisted(() => ({ state: { calls: [] as unknown[], at: 0, status: "ok" } }));
vi.mock("../../live/live-calls-store", () => ({ useLiveCalls: () => polled.state }));
vi.mock("../../frame-store", () => ({ useFrameData: () => ({ live: true }) }));

import { appDict } from "@/i18n/app";

import { StatusCard, type StatusData } from "./StatusCard";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const T = "22222222-2222-2222-2222-222222222222";
const LINES = [
  { who: "assistant" as const, text: "Namaskaram Ravi garu, I called about the silk sarees." },
  { who: "customer" as const, text: "Yes, are there new designs?" },
  { who: "assistant" as const, text: "Shall I send photos on WhatsApp?" },
  { who: "customer" as const, text: "Please do." },
];
const data = (over: Partial<StatusData> = {}): StatusData => ({
  number: "+91 ••••• ••421",
  last: { who: "Lakshmi", lines: LINES },
  nextUp: "Ravi Kumar · 5:30 pm",
  counts: { waiting: 3, visits: 2, enquiries: 4 },
  testHref: `/app/tenants/${T}/calls`,
  callsHref: `/app/tenants/${T}/calls`,
  phoneHref: `/app/tenants/${T}/phone-number`,
  tenantId: T,
  mock: null,
  ...over,
});

beforeEach(() => {
  polled.state = { calls: [], at: 0, status: "ok" };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the status card, no call", () => {
  it("says Ready to answer with the masked number and an idle orb", () => {
    render(<StatusCard data={data()} words={WORDS} />);
    const card = document.querySelector('[data-part="status-card"]') as HTMLElement;
    expect(card).toHaveAttribute("data-state", "idle");
    expect(within(card).getByText("Ready to answer")).toBeInTheDocument();
    expect(within(card).getByText("+91 ••••• ••421")).toBeInTheDocument();
    expect(card.querySelector('[data-orb="ambient"]')).not.toBeNull();
    expect(card.textContent).not.toMatch(/\d{5}\s?\d{5}/); // never a full number
  });
  it("shows the LAST CONVERSATION with its last two lines and a play button, then what is next up and today's counts", () => {
    render(<StatusCard data={data()} words={WORDS} />);
    const last = document.querySelector('[data-part="last-conversation"]') as HTMLElement;
    expect(last).toHaveTextContent("LAST CONVERSATION · Lakshmi");
    expect(within(last).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Shall I send photos on WhatsApp?", "Please do."]);
    fireEvent.click(within(last).getByRole("button", { name: "Play the last conversation" }));
    expect(within(last).getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
    expect(within(last).getByRole("status")).toHaveTextContent("Preview only");
    expect(document.querySelector('[data-part="next-up"]')).toHaveTextContent("Next up:Ravi Kumar · 5:30 pm");
    expect(document.querySelector('[data-part="today-counts"]')).toHaveTextContent("Today3 need you · 2 visits · 4 enquiries");
  });
  it("links Test call and All calls", () => {
    render(<StatusCard data={data()} words={WORDS} />);
    expect(screen.getByRole("link", { name: "Test call" })).toHaveAttribute("href", `/app/tenants/${T}/calls`);
    expect(screen.getByRole("link", { name: "All calls" })).toHaveAttribute("href", `/app/tenants/${T}/calls`);
  });
  it("what it cannot read is not guessed: the number says to connect one, the conversation and next up say there is none yet, no counts", () => {
    render(<StatusCard data={data({ number: null, last: null, nextUp: null, counts: { waiting: null, visits: null, enquiries: null } })} words={WORDS} />);
    expect(document.querySelector('[data-part="masked-number"]')).toBeNull();
    expect(screen.getByRole("link", { name: "No phone number yet" })).toHaveAttribute("href", `/app/tenants/${T}/phone-number`);
    expect(document.querySelector('[data-part="last-conversation"]')).toHaveTextContent("LAST CONVERSATIONNo conversations yet.");
    expect(document.querySelector('[data-part="next-up"]')).toHaveTextContent("Next up:Nothing booked yet");
    expect(document.querySelector('[data-part="today-counts"]')).toBeNull();
    expect(screen.getByText("Ready to answer")).toBeInTheDocument();
  });
});

describe("the status card, a call on the line (mock on staging)", () => {
  it("shows the speaking orb, the caller, the last three lines streaming in and who is speaking", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<StatusCard data={data({ mock: { caller: "Ravi Kumar", lines: LINES }, mockMore: 1 })} words={WORDS} />);
    const card = document.querySelector('[data-part="status-card"]') as HTMLElement;
    expect(card).toHaveAttribute("data-state", "live");
    expect(card.querySelector('[data-orb="speak"]')).not.toBeNull();
    expect(card.querySelector("[data-status=live]")).toHaveTextContent("Live now · 2 calls");
    expect(within(card).getByText("Ravi Kumar")).toBeInTheDocument();
    expect(card.querySelectorAll('[data-part="live-lines"] li')).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(2600));
    expect(card.querySelectorAll('[data-part="live-lines"] li')).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(10_000));
    const lines = [...card.querySelectorAll('[data-part="live-lines"] li')].map((l) => l.textContent);
    expect(lines).toEqual(LINES.slice(1).map((l) => l.text)); // only the last three
    expect(card.querySelector('[data-part="speaking"]')).toHaveTextContent("Ravi Kumar is speaking…");
  });
  it("offers Listen, Whisper and Take over, '+1 more live' and 'Open full call →'", () => {
    render(<StatusCard data={data({ mock: { caller: "Ravi Kumar", lines: LINES.slice(0, 2) }, mockMore: 1 })} words={WORDS} />);
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Whisper" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Take over" })).toBeInTheDocument();
    expect(screen.getByText("+1 more live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open full call →" })).toHaveAttribute("href", `/app/tenants/${T}/calls`);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Preview only");
  });
  it("the assistant's turn says so", () => {
    render(<StatusCard data={data({ mock: { caller: "Ravi Kumar", lines: [LINES[0]] } })} words={WORDS} />);
    expect(screen.getByText("Your assistant is speaking…")).toBeInTheDocument();
  });
});

describe("the status card, a real live call from the poll", () => {
  const CALL = "55555555-5555-4555-8555-555555555555";
  it("shows the caller, the clock, 'On the line' (no words are known), the call's own page for Take over and Open, and the count of others", () => {
    polled.state = { calls: [{ id: CALL, who: "Sri Lakshmi", named: true, elapsedS: 74, answered: true, source: null, canTakeOver: true }, { id: "66666666-6666-4666-8666-666666666666", who: "X", named: true, elapsedS: 5, answered: true, source: null, canTakeOver: false }], at: Date.now(), status: "ok" };
    render(<StatusCard data={data()} words={WORDS} />);
    expect(screen.getByText("Sri Lakshmi")).toBeInTheDocument();
    expect(screen.getByText(/^1:1\d$/)).toBeInTheDocument();
    expect(screen.getByText("On the line")).toBeInTheDocument();
    expect(screen.getByText("+1 more live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Take over" })).toHaveAttribute("href", `/app/tenants/${T}/calls/${CALL}`);
    expect(screen.getByRole("link", { name: "Open full call →" })).toHaveAttribute("href", `/app/tenants/${T}/calls/${CALL}`);
  });
  it("offers no Take over where the person may not take the call over", () => {
    polled.state = { calls: [{ id: CALL, who: "Sri Lakshmi", named: true, elapsedS: 3, answered: true, source: null, canTakeOver: false }], at: Date.now(), status: "ok" };
    render(<StatusCard data={data()} words={WORDS} />);
    expect(screen.queryByRole("link", { name: "Take over" })).toBeNull();
  });
});
