import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { schedulerSettings } from "@/lib/api/scheduler-fixtures";
import { appDict } from "@/i18n/app";

import { AutomationSimple } from "./AutomationSimple";
import { WORDS } from "./agent-test-kit";

afterEach(cleanup);
const words = { ...WORDS, ...Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("auto.f.") || k.startsWith("set.f."))) };
const OUT = { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 };
const saveSending = vi.fn(async () => ({ ok: true as const, message: "Limits stored." }));
const draw = () =>
  render(<AutomationSimple plain words={words} settings={OUT} reminders={schedulerSettings()} actions={{ saveSending, saveQuietHours: vi.fn(), saveReminders: vi.fn() } as never} />);

describe("Settings > Limits without sentences (SETTINGS_OPEN)", () => {
  it("each choice is a labelled field; no sentence, no What-it-will-do label", () => {
    draw();
    expect(screen.getByLabelText("Most messages to one customer a day")).toBeInTheDocument();
    expect(screen.getByLabelText("Quiet from (India time)")).toBeInTheDocument();
    expect(screen.getByLabelText("Quiet until (India time)")).toBeInTheDocument();
    expect(screen.getByLabelText("Evening reminder to visitors")).toBeInTheDocument();
    expect(screen.queryByText(/At most/)).toBeNull();
    expect(screen.queryByText("What it will do:")).toBeNull();
  });
  it("Save wakes on a change, says 'You have unsaved changes.' and sends through the same action, then 'Saved.'", async () => {
    draw();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Most messages to one customer a day"), { target: { value: "5" } });
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await act(async () => fireEvent.click(save));
    expect(saveSending).toHaveBeenCalledWith({ auto_send_enabled: false, per_customer_daily_limit: 5 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
