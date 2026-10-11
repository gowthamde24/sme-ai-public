import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AiUsage } from "@/lib/api/ai-usage";

import { FrameDataSlot } from "../frame-store";
import { TodayUsage } from "./TodayUsage";
import { WORDS } from "./today-test-kit";

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({ today_percent: 7, month_percent: 38, resets_at_today: "2026-10-11T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok", ...over });
const frame = (over: Partial<{ usage: AiUsage | null; ready: boolean; showUsage: boolean }> = {}) => ({ plan: null, usage: usage(), waiting: null, ready: true, showUsage: true, ...over });
const show = async (data: ReturnType<typeof frame>) => {
  await act(async () => {
    render(
      <>
        <FrameDataSlot data={data} />
        <TodayUsage words={WORDS} settingsHref="/app/tenants/T/settings" />
      </>,
    );
  });
};
afterEach(cleanup);

describe("the usage card in the header", () => {
  it("shows what is LEFT of the month as a percentage and a bar, never a count of anything", async () => {
    await show(frame());
    const meter = screen.getByRole("meter", { name: "Agent OWL usage this month: 62% left" });
    expect(meter).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("Agent OWL this month")).toBeInTheDocument();
    expect(screen.getByText("62% left")).toBeInTheDocument();
    expect(meter.firstElementChild!.className).toContain("w-[60%]"); // the bar, in steps of 5
    expect(document.body.textContent).not.toMatch(/token|₹|\d+ (calls|requests|messages)/i);
  });
  it("on a phone it is a small pill that opens Settings", async () => {
    await show(frame());
    const link = screen.getByRole("link", { name: "Agent OWL usage this month: 62% left" });
    expect(link).toHaveAttribute("href", "/app/tenants/T/settings");
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("md:hidden");
    expect(link).toHaveTextContent("62%");
  });
  it("busy, light and paused states change the colour and say so in words", async () => {
    await show(frame({ usage: usage({ month_percent: 100, state: "light", resets_at_month: "2026-10-31T18:30:00Z" }) }));
    expect(screen.getByText(/^Light mode until /)).toBeInTheDocument();
    expect(screen.getByRole("meter").firstElementChild!.className).toContain("bg-amber-text");
    cleanup();
    await show(frame({ usage: usage({ month_percent: 100, today_percent: 40, state: "paused" }) }));
    expect(screen.getByText(/^Your AI team is paused until /)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });
  it("is not drawn for a role the API does not give it to", async () => {
    await show(frame({ showUsage: false }));
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText("Agent OWL this month")).toBeNull();
  });
  it("says 'Not available yet' when it cannot be read, and is a quiet placeholder while it is being read", async () => {
    await show(frame({ usage: null }));
    expect(screen.getByText(/Agent OWL this month: Not available yet/)).toBeInTheDocument();
    cleanup();
    await act(async () => void render(<TodayUsage words={WORDS} settingsHref="/x" />)); // no frame data yet
    expect(document.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    void within;
  });
});
