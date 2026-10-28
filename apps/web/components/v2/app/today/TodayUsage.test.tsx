import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AiUsage } from "@/lib/api/ai-usage";

import { FrameDataSlot } from "../frame-store";
import { TodayUsage } from "./TodayUsage";
import { WORDS } from "./today-test-kit";
import type { TodayData } from "./types";

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({ today_percent: 7, month_percent: 38, resets_at_today: "2026-10-11T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok", ...over });
const frame = (over: Partial<{ usage: AiUsage | null; ready: boolean; showUsage: boolean }> = {}) => ({ plan: null, usage: usage(), waiting: null, ready: true, showUsage: true, pack: null, ...over });
const show = async (data: ReturnType<typeof frame>, week: TodayData["week"] = { percent: 38 }) => {
  await act(async () => {
    render(
      <>
        <FrameDataSlot data={data} />
        <TodayUsage words={WORDS} settingsHref="/app/tenants/T/settings" week={week} />
      </>,
    );
  });
};
afterEach(cleanup);

describe("the usage card in the header (the week)", () => {
  it("shows what is LEFT of the week as a percentage and a bar, never a count of anything", async () => {
    await show(frame());
    const meter = screen.getByRole("meter", { name: "Your assistant usage this week: 62% left" });
    expect(meter).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("Your assistant this week")).toBeInTheDocument();
    expect(screen.getByText("62% left")).toBeInTheDocument();
    expect(meter.firstElementChild!.className).toContain("w-[60%]"); // the bar, in steps of 5
    expect(document.body.textContent).not.toMatch(/token|₹|month|\d+ (calls|requests|messages)/i);
  });
  it("the figure is the WEEK's, not the month's or the day's", async () => {
    await show(frame({ usage: usage({ month_percent: 90, today_percent: 99 }) }), { percent: 12 });
    expect(screen.getByText("88% left")).toBeInTheDocument();
  });
  it("on a phone it is a small pill that opens Settings", async () => {
    await show(frame());
    const link = screen.getByRole("link", { name: "Your assistant usage this week: 62% left" });
    expect(link).toHaveAttribute("href", "/app/tenants/T/settings");
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("md:hidden");
    expect(link).toHaveTextContent("62%");
  });
  it("busy, light and paused states change the colour and say so in words", async () => {
    await show(frame({ usage: usage({ month_percent: 100, state: "light", resets_at_month: "2026-10-31T18:30:00Z" }) }), { percent: 100 });
    expect(screen.getByText(/^Light mode until /)).toBeInTheDocument();
    expect(screen.getByRole("meter").firstElementChild!.className).toContain("bg-amber-text");
    cleanup();
    await show(frame({ usage: usage({ month_percent: 100, today_percent: 40, state: "paused" }) }), { percent: 100 });
    expect(screen.getByText(/^Your AI team is paused until /)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });
  it("is not drawn for a role the API does not give it to", async () => {
    await show(frame({ showUsage: false }));
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText("Your assistant this week")).toBeNull();
  });
  it("still draws the week when the menu's card could not be read (no colour or note from it)", async () => {
    await show(frame({ usage: null }));
    expect(screen.getByText("62% left")).toBeInTheDocument();
    expect(screen.getByRole("meter").firstElementChild!.className).toContain("bg-brand");
  });
  it("says 'Not available yet' when the week could not be read, and never shows another window's number instead", async () => {
    await show(frame(), "error");
    expect(screen.getByText(/Your assistant this week: Not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText(/% left/)).toBeNull();
    cleanup();
    await show(frame(), null);
    expect(screen.getByText(/Your assistant this week: Not available yet/)).toBeInTheDocument();
    void within;
  });
});
