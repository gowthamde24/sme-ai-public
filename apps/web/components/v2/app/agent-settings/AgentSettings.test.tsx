import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schedulerSettings } from "@/lib/api/scheduler-fixtures";
import { STATUS_JSON } from "@/lib/api/scheduler-fixtures";
import type { SchedulerStatus } from "@/lib/api/scheduler";

import { QuietHoursForm, RemindersForm, SendingForm, eveningInsideQuiet } from "./AgentSettingsForms";
import { SchedulerCard, SystemSwitchCard } from "./AgentStatusCards";
import { NOW, WORDS, ok } from "./agent-test-kit";

const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const status = (over: Partial<SchedulerStatus> = {}) => ({ ...(STATUS_JSON as SchedulerStatus), ...over });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("automatic sending", () => {
  const SETTINGS = { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 };
  it("one plain sentence about what it means, the switch off until the Owner turns it on, and the daily limit", () => {
    render(<SendingForm words={WORDS} settings={SETTINGS} save={ok("Saved.")} />);
    expect(screen.getByText("Your assistant sends routine replies by itself. Anything about money, complaints or calls waits for you.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Your assistant may send routine replies by itself" })).not.toBeChecked();
    expect(screen.getByText("Off: new messages wait for you to approve them. Messages you approve still go out.")).toBeInTheDocument();
    expect(screen.getByLabelText("Messages per customer per day")).toHaveValue(3);
    expect(screen.getByText("Saving needs your two-step code first (sign in again with it).")).toBeInTheDocument();
  });
  it("turning it on says what that means, and saving sends exactly the two settings", async () => {
    const save = ok("Saved. Automatic sending is on.");
    render(<SendingForm words={WORDS} settings={SETTINGS} save={save} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Your assistant may send/ }));
    expect(screen.getByText(/On: routine replies go out by themselves/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Messages per customer per day"), { target: { value: "5" } });
    await click("Save");
    expect(save).toHaveBeenCalledWith({ auto_send_enabled: true, per_customer_daily_limit: 5 });
    expect(screen.getByRole("status")).toHaveTextContent("Saved. Automatic sending is on.");
  });
  it("without the second factor it says so and points at Security, keeping what was set", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true }));
    render(<SendingForm words={WORDS} settings={SETTINGS} save={save} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Your assistant may send/ }));
    await click("Save");
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("checkbox", { name: /Your assistant may send/ })).toBeChecked();
  });
  it.each(["0", "21", "2.5", ""])("a daily limit of %j cannot be saved", (v) => {
    render(<SendingForm words={WORDS} settings={SETTINGS} save={ok("x")} />);
    fireEvent.change(screen.getByLabelText("Messages per customer per day"), { target: { value: v } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("a double press saves once while the first is out", async () => {
    let finish!: (v: { ok: true; message: string }) => void;
    const save = vi.fn(() => new Promise<{ ok: true; message: string }>((r) => (finish = r)));
    render(<SendingForm words={WORDS} settings={SETTINGS} save={save} />);
    await click("Save");
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    await act(async () => finish({ ok: true, message: "Saved." }));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("visit reminders", () => {
  it("shows the three settings with their values, and says these are the standard ones until saved", () => {
    render(<RemindersForm words={WORDS} settings={schedulerSettings()} save={ok("x")} />);
    expect(screen.getByRole("checkbox", { name: "Remind the evening before" })).toBeChecked();
    expect(screen.getByLabelText("From")).toHaveValue("18");
    expect(screen.getByRole("checkbox", { name: "Send a heads-up before the visit" })).toBeChecked();
    expect(screen.getByLabelText("How long before")).toHaveValue("120");
    expect(screen.getByRole("checkbox", { name: /did not come/ })).not.toBeChecked();
    expect(screen.getByLabelText("After the visit time has ended by")).toHaveValue("30");
    expect(screen.getByText(/These are the standard settings/)).toBeInTheDocument();
  });
  it("the hours offered are 9 to 20 only (never at or after 21:00), and the minutes stay inside the API's bounds", () => {
    render(<RemindersForm words={WORDS} settings={schedulerSettings()} save={ok("x")} />);
    const hours = within(screen.getByLabelText("From")).getAllByRole("option").map((o) => o.textContent);
    expect(hours[0]).toBe("09:00");
    expect(hours.at(-1)).toBe("20:00");
    const heads = within(screen.getByLabelText("How long before")).getAllByRole("option").map((o) => Number(o.getAttribute("value")));
    expect(Math.min(...heads)).toBe(60);
    expect(Math.max(...heads)).toBe(480);
    const after = within(screen.getByLabelText("After the visit time has ended by")).getAllByRole("option").map((o) => Number(o.getAttribute("value")));
    expect(Math.min(...after)).toBe(5);
    expect(Math.max(...after)).toBe(720);
  });
  it("the time fields are disabled while their switch is off", () => {
    render(<RemindersForm words={WORDS} settings={schedulerSettings({ reminder_evening_enabled: false, no_show_enabled: false })} save={ok("x")} />);
    expect(screen.getByLabelText("From")).toBeDisabled();
    expect(screen.getByLabelText("After the visit time has ended by")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /did not come/ }));
    expect(screen.getByLabelText("After the visit time has ended by")).toBeEnabled();
  });
  it("saves the whole set at once, as set", async () => {
    const save = ok("Saved. Messages that are already waiting are not changed.");
    render(<RemindersForm words={WORDS} settings={schedulerSettings({ is_default: false })} save={save} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "19" } });
    fireEvent.change(screen.getByLabelText("How long before"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /did not come/ }));
    fireEvent.change(screen.getByLabelText("After the visit time has ended by"), { target: { value: "60" } });
    await click("Save");
    expect(save).toHaveBeenCalledWith({ reminder_evening_enabled: true, reminder_evening_hour: 19, reminder_heads_up_enabled: true, reminder_heads_up_minutes: 180, no_show_enabled: true, no_show_after_minutes: 60 });
    expect(screen.getByRole("status")).toHaveTextContent("Saved. Messages that are already waiting are not changed.");
    expect(screen.queryByText(/standard settings/)).toBeNull();
  });
  it("a value saved earlier that is not in the list is kept", () => {
    render(<RemindersForm words={WORDS} settings={schedulerSettings({ reminder_heads_up_minutes: 100, is_default: false })} save={ok("x")} />);
    expect(screen.getByLabelText("How long before")).toHaveValue("100");
  });
  it("a refusal is shown, with the way to Security when the second factor is missing", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true }));
    render(<RemindersForm words={WORDS} settings={schedulerSettings()} save={save} />);
    await click("Save");
    expect(screen.getByRole("alert")).toHaveTextContent("This needs your two-step code, if you turned it on.");
    expect(screen.getByRole("link", { name: "Open Security" })).toBeInTheDocument();
  });
});

describe("quiet hours (editable within the API's limits, job BE)", () => {
  const OUT = { platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 4, quiet_hours_start: 21, quiet_hours_end: 9 };
  const REM = schedulerSettings({ reminder_evening_enabled: true, reminder_evening_hour: 18 });
  const show = (reminders = REM, save: ReturnType<typeof vi.fn> = ok("Saved.")) => {
    render(<QuietHoursForm words={WORDS} settings={OUT} reminders={reminders} save={save as never} />);
    return save;
  };
  const options = (label: string) => within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent);

  it("starts from the hours on record; the start can be 19:00 to 23:00 and the end 07:00 to 10:00, nothing else is offered", () => {
    show();
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("21");
    expect(screen.getByLabelText("Quiet hours end")).toHaveValue("9");
    expect(options("Quiet hours start")).toEqual(["19:00", "20:00", "21:00", "22:00", "23:00"]);
    expect(options("Quiet hours end")).toEqual(["07:00", "08:00", "09:00", "10:00"]);
    expect(screen.getByText(/India time\. Nothing goes out from the start hour until the end hour/)).toBeInTheDocument();
  });

  it("saves the chosen hours with the sending values on record (the same PUT needs them), says what was saved, and needs the authenticator", async () => {
    const save = show();
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText("Quiet hours end"), { target: { value: "8" } });
    await click("Save quiet hours");
    expect(save).toHaveBeenCalledWith({ quiet_hours_start: 22, quiet_hours_end: 8, auto_send_enabled: true, per_customer_daily_limit: 4 });
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.getByText("Saving needs your two-step code first (sign in again with it).")).toBeInTheDocument();
  });

  it("a missing second factor is explained and points at Security; the choice stays on the screen", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true }));
    show(REM, save);
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "20" } });
    await click("Save quiet hours");
    expect(screen.getByRole("alert")).toHaveTextContent("This needs your two-step code, if you turned it on.");
    expect(screen.getByRole("link", { name: "Open Security" })).toBeInTheDocument();
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("20");
  });

  it("one sentence when the evening reminder falls INSIDE the quiet hours (no evening reminder; the heads-up still goes), following the start as it is picked", () => {
    show(schedulerSettings({ reminder_evening_enabled: true, reminder_evening_hour: 20 }));
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toBeNull(); // 20:00 is before 21:00
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "20" } });
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toHaveTextContent("The evening reminder (20:00) is inside quiet hours that start at 20:00, so no evening reminder is sent. The heads-up before the visit still goes.");
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "19" } });
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toHaveTextContent("quiet hours that start at 19:00");
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "23" } });
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toBeNull();
  });

  it("no such sentence when the evening reminder is off or could not be read", () => {
    show(schedulerSettings({ reminder_evening_enabled: false, reminder_evening_hour: 20 }));
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "19" } });
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toBeNull();
    cleanup();
    render(<QuietHoursForm words={WORDS} settings={OUT} reminders={null} save={ok("x")} />);
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "19" } });
    expect(document.querySelector('[data-note="evening-inside-quiet"]')).toBeNull();
  });

  it("the rule itself: inside when the evening hour is at or after the start", () => {
    expect(eveningInsideQuiet(true, 20, 20)).toBe(true);
    expect(eveningInsideQuiet(true, 20, 21)).toBe(false);
    expect(eveningInsideQuiet(true, 9, 19)).toBe(false);
    expect(eveningInsideQuiet(false, 20, 19)).toBe(false);
  });
});

describe("the system switch (read only)", () => {
  it("the system switch says On or Stopped and can only be read", () => {
    render(<SystemSwitchCard words={WORDS} settings={{ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }} />);
    expect(screen.getByText("On")).toBeInTheDocument();
    cleanup();
    render(<SystemSwitchCard words={WORDS} settings={{ platform_switch_on: false, auto_send_enabled: true, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 }} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText(/Nothing goes out and everything waits\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<SystemSwitchCard words={WORDS} settings={null} />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});

describe("Your assistant's checks card", () => {
  it("shows the state, the last and next check, the last activity and today's counts", () => {
    render(<SchedulerCard words={WORDS} status={status({ next_run_at: "2026-10-14T04:31:00Z" })} now={NOW} />);
    expect(screen.getByText("Working for this business")).toBeInTheDocument();
    expect(screen.getByText("2 min ago")).toBeInTheDocument();
    expect(screen.getByText("10:01")).toBeInTheDocument();
    expect(screen.getByText("9:00")).toBeInTheDocument(); // last activity 03:30Z
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["2 sent", "1 reminders", "0 marked did not come", "0 failed", "0 errors"]);
    expect(document.querySelector('[data-scheduler="stale"]')).toBeNull();
  });
  it("says approved messages still go out when automatic sending is off (releases_approved), and that they wait when the system switch is off", () => {
    render(<SchedulerCard words={WORDS} status={status({ auto_send_enabled: false, active: false, releases_approved: true })} now={NOW} />);
    expect(document.querySelector('[data-line="releases-approved"]')).toHaveTextContent("Approved messages still go out when automatic sending is off.");
    cleanup();
    render(<SchedulerCard words={WORDS} status={status({ platform_switch_on: false, active: false, releases_approved: false })} now={NOW} />);
    expect(document.querySelector('[data-line="releases-approved"]')).toHaveTextContent("Approved messages wait: sending is stopped for the whole system.");
  });
  it("a calm warning when it should be working and has not checked for more than five minutes", () => {
    render(<SchedulerCard words={WORDS} status={status({ last_run_at: "2026-10-14T04:10:00Z" })} now={NOW} />);
    expect(document.querySelector('[data-scheduler="stale"]')).toHaveTextContent("Your assistant has not checked for 20 minutes.");
  });
  it("says why it is idle when a switch is off, without a warning", () => {
    render(<SchedulerCard words={WORDS} status={status({ auto_send_enabled: false, active: false, last_run_at: "2026-10-14T00:00:00Z" })} now={NOW} />);
    expect(screen.getByText("Idle: automatic sending is off")).toBeInTheDocument();
    expect(document.querySelector('[data-scheduler="stale"]')).toBeNull();
    cleanup();
    render(<SchedulerCard words={WORDS} status={status({ platform_switch_on: false, active: false })} now={NOW} />);
    expect(screen.getByText("Idle: sending is stopped for the system")).toBeInTheDocument();
  });
  it("never heard from, and 'Not available yet' when it could not be read", () => {
    render(<SchedulerCard words={WORDS} status={status({ last_run_at: null, next_run_at: null, worker_running: false })} now={NOW} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
    cleanup();
    render(<SchedulerCard words={WORDS} status={null} now={NOW} />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("shows counts only: no phone number, name or words", () => {
    render(<SchedulerCard words={WORDS} status={status()} now={NOW} />);
    expect(document.body.textContent).not.toMatch(/\+?\d[\d ]{9,}|@/);
  });
});
