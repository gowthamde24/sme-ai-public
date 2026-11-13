import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const polled = vi.hoisted(() => ({ state: { calls: [] as unknown[], at: 0, status: "ok" } }));
vi.mock("../../live/live-calls-store", () => ({ useLiveCalls: () => polled.state }));

import { appDict } from "@/i18n/app";

import { buildDay } from "./day-data";
import YourDay from "./YourDay";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tv6.")));
const NOW = Date.parse("2026-11-13T10:40:00+05:30");
const at = (hhmm: string) => `2026-11-13T${hhmm}:00+05:30`;
const T = "22222222-2222-2222-2222-222222222222";
const view = () => buildDay({ now: NOW, calls: [at("09:05"), at("09:20"), at("09:35"), at("10:10")], visits: [{ startsAt: at("11:00"), who: "Anitha" }, { startsAt: at("15:30"), who: "Lakshmi & mother" }], sent: 2, planned: { n: 4, toMinute: 1200 } });

beforeEach(() => {
  polled.state = { calls: [], at: 0, status: "ok" };
});
afterEach(cleanup);

describe("Your day (the final design)", () => {
  it("is a full-width card with the title and ONE summary line: calls handled · sent to you · next", () => {
    render(<YourDay view={view()} words={WORDS} tenantId={T} mockLive={null} />);
    expect(screen.getByRole("heading", { name: /Your day/ })).toBeInTheDocument();
    expect(document.querySelector('[data-part="day-summary"]')).toHaveTextContent("4 calls handled · 2 sent to you · next: 4 call-backs at 11:00");
  });

  it("draws the hours 9am to 9pm, a dot for each call, green pins with name and time, the Now line and dashed call-backs", () => {
    render(<YourDay view={view()} words={WORDS} tenantId={T} mockLive={null} />);
    expect([...document.querySelectorAll("section [aria-hidden=true] > span > span")].map((x) => x.textContent).filter((x) => /^\d+(am|pm)$/.test(x ?? ""))).toEqual(["9am", "11am", "1pm", "3pm", "5pm", "7pm", "9pm"]);
    expect(document.querySelectorAll('[data-dot="call"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-dot="planned"]')).toHaveLength(4);
    const pins = [...document.querySelectorAll('[data-pin="visit"]')];
    expect(pins.map((p) => p.textContent)).toEqual(["Anitha11:00", "Lakshmi & mother15:30"]);
    expect(document.querySelector('[data-part="now-line"]')).toHaveTextContent("Now 10:40");
  });

  it("the newest dot pulses while a call is live, and not otherwise", () => {
    const { unmount } = render(<YourDay view={view()} words={WORDS} tenantId={T} mockLive={null} />);
    expect(document.querySelector(".ds-pulse-dot")).toBeNull();
    unmount();
    polled.state = { calls: [{ id: "c", who: "Meena", named: true, elapsedS: 5, answered: true, source: null, canTakeOver: true }], at: Date.now(), status: "ok" };
    render(<YourDay view={view()} words={WORDS} tenantId={T} mockLive={null} />);
    const dots = [...document.querySelectorAll('[data-dot="call"]')];
    expect(dots.filter((d) => d.classList.contains("ds-pulse-dot"))).toHaveLength(1);
    expect(dots.at(-1)).toHaveClass("ds-pulse-dot");
  });

  it("the newest dot pulses for a call the page read as live, before the poll has answered", () => {
    render(<YourDay view={view()} words={WORDS} tenantId={T} mockLive={null} liveCalls={[{ id: "c", who: "Meena", elapsedS: 5 }]} />);
    expect(document.querySelectorAll(".ds-pulse-dot")).toHaveLength(1);
  });

  it("scrolls sideways on a phone and leaves out what it cannot read", () => {
    render(<YourDay view={buildDay({ now: NOW, calls: null, visits: null, sent: null, planned: null })} words={WORDS} tenantId={T} mockLive={null} />);
    expect(document.querySelector(".ds-day-scroll")).toHaveClass("overflow-x-auto");
    expect(document.querySelector('[data-part="day-track"]')).toHaveClass("min-w-[760px]");
    expect(document.querySelector('[data-part="day-summary"]')).toBeNull();
    expect(document.querySelectorAll('[data-dot="call"]')).toHaveLength(0);
  });
});
