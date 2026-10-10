import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AiUsage } from "@/lib/api/ai-usage";

import { UsageCard, indiaTime, untilFor } from "./frame-parts";

afterEach(cleanup);

const DAY = "2026-10-10T18:30:00Z"; // 11 Oct, 12:00 am, Indian time
const MONTH = "2026-10-31T18:30:00Z"; // 1 Nov, 12:00 am
const usage = (o: Partial<AiUsage>): AiUsage => ({ today_percent: 10, month_percent: 4, resets_at_today: DAY, resets_at_month: MONTH, state: "ok", ...o });

describe("indiaTime", () => {
  it("draws the moment in the Indian day, whatever the device's zone", () => {
    expect(indiaTime(DAY)).toMatch(/^11 Oct,? 12:00\s?am$/i);
    expect(indiaTime(MONTH)).toMatch(/^1 Nov,? 12:00\s?am$/i);
  });
});

describe("untilFor", () => {
  it("ok and warn have no end time", () => {
    expect(untilFor(usage({}))).toBeNull();
    expect(untilFor(usage({ state: "warn", today_percent: 85 }))).toBeNull();
  });
  it("light ends at the day's reset, or the month's when the month is full (the later one when both are)", () => {
    expect(untilFor(usage({ state: "light", today_percent: 100 }))).toBe(DAY);
    expect(untilFor(usage({ state: "light", today_percent: 100, month_percent: 100 }))).toBe(MONTH);
    expect(untilFor(usage({ state: "light", month_percent: 100, today_percent: 20 }))).toBe(MONTH);
  });
  it("a pause names a time only when one window can be the cause; with both full it does not guess", () => {
    expect(untilFor(usage({ state: "paused", today_percent: 100 }))).toBe(DAY);
    expect(untilFor(usage({ state: "paused", month_percent: 100, today_percent: 30 }))).toBe(MONTH);
    expect(untilFor(usage({ state: "paused", today_percent: 100, month_percent: 100 }))).toBeNull();
  });
});

describe("UsageCard", () => {
  it("ok: the percentages and a 0-100 meter, no money, no notice", () => {
    render(<UsageCard usage={usage({ today_percent: 38, month_percent: 12 })} />);
    expect(screen.getByText("38% used")).toBeInTheDocument();
    expect(screen.getByText("12% of this month")).toBeInTheDocument();
    const meter = screen.getByRole("meter", { name: "AI usage today" });
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuenow", "38");
    expect(screen.queryByText(/₹|busy|Light mode|paused/)).toBeNull();
  });
  it("warn: the owner-approved sentence", () => {
    render(<UsageCard usage={usage({ state: "warn", today_percent: 84 })} />);
    expect(screen.getByText("Your AI team has been busy today. It keeps working; at the limit it switches to a lighter mode until midnight.")).toBeInTheDocument();
  });
  it("light: the chip with the time; the meter stays at 100 (the state carries light)", () => {
    render(<UsageCard usage={usage({ state: "light", today_percent: 100 })} />);
    expect(screen.getByText(/^Light mode until 11 Oct,? 12:00\s?am$/i)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });
  it("paused: says what keeps working; a time only when known", () => {
    const { unmount } = render(<UsageCard usage={usage({ state: "paused", today_percent: 100 })} />);
    expect(screen.getByText(/^Your AI team is paused until 11 Oct,? 12:00\s?am\. Quotes, orders and customers keep working\.$/i)).toBeInTheDocument();
    unmount();
    render(<UsageCard usage={usage({ state: "paused", today_percent: 100, month_percent: 100 })} />);
    expect(screen.getByText("Your AI team is paused for now. Quotes, orders and customers keep working.")).toBeInTheDocument();
  });
  it("uses the server's words when it sends them", () => {
    render(<UsageCard usage={usage({ today_percent: 9 })} labels={{ "frame.aiused": "{percent}% వాడారు" }} />);
    expect(screen.getByText("9% వాడారు")).toBeInTheDocument();
  });
  it("is empty while loading and says 'Not available yet' when it cannot be read", () => {
    const { unmount } = render(<UsageCard usage={null} loading />);
    expect(screen.queryByText("Not available yet")).toBeNull();
    unmount();
    render(<UsageCard usage={null} />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});
