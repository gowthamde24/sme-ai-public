import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schedulerSettings } from "@/lib/api/scheduler-fixtures";

import { AutomationSimple } from "./AutomationSimple";
import { autoEffects, type AutoValues } from "./automation-effect";
import { WORDS } from "./agent-test-kit";
import { makeT } from "../words";

const OUT = {
  platform_switch_on: true,
  auto_send_enabled: false,
  per_customer_daily_limit: 3,
  quiet_hours_start: 21,
  quiet_hours_end: 9,
};
const ok = (message: string) =>
  vi.fn(async () => ({ ok: true as const, message }));
const mfa = () =>
  vi.fn(async () => ({
    ok: false as const,
    error:
      "This needs your two-step code, if you turned it on. Nothing was changed.",
    mfa: true,
  }));
const actions = (over: Record<string, unknown> = {}) =>
  ({
    saveSending: ok("Saved. Automatic sending is on."),
    saveQuietHours: ok("Saved. Quiet hours are 21:00 to 09:00."),
    saveReminders: ok(
      "Saved. Messages that are already waiting are not changed.",
    ),
    ...over,
  }) as never;
const view = (
  a = actions(),
  over = {},
  reminders: ReturnType<typeof schedulerSettings> | null = schedulerSettings(),
) => {
  render(
    <AutomationSimple
      words={WORDS}
      settings={{ ...OUT, ...over }}
      reminders={reminders}
      actions={a}
    />,
  );
  return a as unknown as Record<
    "saveSending" | "saveQuietHours" | "saveReminders",
    ReturnType<typeof vi.fn>
  >;
};
const pill = (name: string) => screen.getByRole("combobox", { name });
const save = () => screen.getByRole("button", { name: /^(Save|Working…)$/ });
const press = () => act(async () => fireEvent.click(save()));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Settings > Automation under JOBS: sentences with the choice inside", () => {
  it("draws the three blocks as sentences, one help line, the effect lines and a round tick", () => {
    view();
    expect(
      screen.getByText(/Only customers who enquired get a message/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Automatic sending" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quiet hours" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Visit reminders" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /Let my assistant send routine replies by itself/,
      }),
    ).not.toBeChecked();
    expect(pill("At most … messages per customer a day")).toHaveValue("3");
    expect(pill("Stay quiet from … to … (India time) (1)")).toHaveValue("21");
    expect(pill("Stay quiet from … to … (India time) (2)")).toHaveValue("9");
    expect(pill("Remind visitors …")).toHaveValue("18");
    expect(pill("Send a heads-up …")).toHaveValue("120");
    // no old form, no number box, no square tick list: one page, ONE save
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /Save/ })).toHaveLength(1);
    expect(
      screen.getByText(
        "Saving needs your two-step code first (sign in again with it).",
      ),
    ).toBeInTheDocument();
  });
  it("the pills read as words: hours as 9 pm, minutes as hours, never for a choice that is off", () => {
    view();
    const text = (name: string) =>
      within(pill(name))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(text("Stay quiet from … to … (India time) (1)")).toEqual([
      "7 pm",
      "8 pm",
      "9 pm",
      "10 pm",
      "11 pm",
    ]);
    expect(text("Stay quiet from … to … (India time) (2)")).toEqual([
      "7 am",
      "8 am",
      "9 am",
      "10 am",
    ]);
    expect(text("Remind visitors …").slice(0, 2)).toEqual([
      "never",
      "the evening before, from 9 am",
    ]);
    expect(text("Remind visitors …").at(-1)).toBe(
      "the evening before, from 8 pm",
    );
    expect(text("Send a heads-up …").slice(0, 4)).toEqual([
      "never",
      "1 hour before the visit",
      "90 minutes before the visit",
      "2 hours before the visit",
    ]);
    expect(text("At most … messages per customer a day")).toHaveLength(20);
  });
  it("the did-not-come choice is under More choices (a closed details), off unless switched on", () => {
    view();
    const more = document.querySelector(
      '[data-part="auto-more"]',
    ) as HTMLElement;
    expect(more.tagName).toBe("DETAILS");
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByText("More choices")).toBeInTheDocument();
    expect(
      within(more).getByRole("combobox", {
        name: "Mark a visit as did-not-come …",
      }),
    ).toHaveValue("off");
    expect(
      within(more).getByRole("combobox", {
        name: "Mark a visit as did-not-come …",
      }).parentElement?.textContent,
    ).toContain("never");
  });
  it("says the reminders are the standard ones (a solid info chip) until the person saves their own", async () => {
    const a = view();
    expect(
      screen.getByText("Standard settings until you save yours"),
    ).toBeInTheDocument();
    fireEvent.change(pill("Send a heads-up …"), { target: { value: "180" } });
    await press();
    expect(a.saveReminders).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Standard settings until you save yours"),
    ).toBeNull();
  });
});

describe("What it will do (follows every tap)", () => {
  const effect = (i: number) =>
    document.querySelectorAll('[data-part="effect"]')[i] as HTMLElement;
  it("quiet hours: an enquiry before and after the start, then nothing until the end hour", () => {
    view(actions(), { auto_send_enabled: true });
    expect(effect(0)).toHaveTextContent(
      "What it will do: A customer who enquires at 8:15 pm gets a WhatsApp reply at once. One who enquires at 9:15 pm gets nothing until 9 am, then a WhatsApp.",
    );
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "22" },
    });
    fireEvent.change(pill("Stay quiet from … to … (India time) (2)"), {
      target: { value: "8" },
    });
    expect(effect(0)).toHaveTextContent(
      "enquires at 9:15 pm gets a WhatsApp reply at once. One who enquires at 10:15 pm gets nothing until 8 am",
    );
  });
  it("with sending off it says nothing goes out in quiet hours instead of promising a reply", () => {
    view();
    expect(effect(0)).toHaveTextContent(
      "Nothing is sent from 9 pm until 9 am; what is due waits for 9 am.",
    );
  });
  it("visits: a reminder, a heads-up and the did-not-come mark, with the day's example moving with the choices", () => {
    view(actions(), { auto_send_enabled: true });
    expect(effect(1)).toHaveTextContent(
      "A visit tomorrow at 11:30 am: a reminder this evening at 6 pm, a heads-up at 9:30 am.",
    );
    fireEvent.change(pill("Send a heads-up …"), { target: { value: "off" } });
    expect(effect(1)).toHaveTextContent(
      "A visit tomorrow at 11:30 am: a reminder this evening at 6 pm.",
    );
    fireEvent.change(pill("Mark a visit as did-not-come …"), {
      target: { value: "45" },
    });
    expect(effect(1)).toHaveTextContent(
      "marked did not come 45 minutes after it ends, if nobody comes",
    );
    fireEvent.change(pill("Remind visitors …"), { target: { value: "off" } });
    fireEvent.change(pill("Mark a visit as did-not-come …"), {
      target: { value: "off" },
    });
    expect(effect(1)).toHaveTextContent("No reminders go out for a visit.");
  });
  it("an evening reminder at or after the quiet start says there will be none (and the sentence of before is kept)", () => {
    view(actions(), { auto_send_enabled: true });
    fireEvent.change(pill("Remind visitors …"), { target: { value: "20" } });
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "19" },
    });
    expect(
      document.querySelector('[data-note="evening-inside-quiet"]'),
    ).toHaveTextContent(
      "The evening reminder (20:00) is inside quiet hours that start at 19:00, so no evening reminder is sent.",
    );
    expect(effect(1)).toHaveTextContent(
      "no evening reminder (it would fall in quiet hours)",
    );
  });
  it("with sending off the visit line says nothing is sent yet", () => {
    view();
    expect(effect(1)).toHaveTextContent(
      "Nothing is sent until automatic sending is on.",
    );
  });
  it("a heads-up long before the visit is not put in quiet hours: the example visit moves later", () => {
    const t = makeT(WORDS);
    const v: AutoValues = {
      auto: true,
      limit: "3",
      quietStart: "21",
      quietEnd: "10",
      evening: false,
      eveningHour: "18",
      heads: true,
      headsMinutes: "480",
      noShow: false,
      noShowMinutes: "30",
    };
    expect(autoEffects(v, t).visits).toBe(
      "A visit tomorrow at 6:30 pm: a heads-up at 10:30 am.",
    );
  });
});

describe("ONE Save: only what changed, through the same three actions", () => {
  it("Save is off until something changes, then says Not saved yet", async () => {
    view();
    expect(save()).toBeDisabled();
    expect(screen.queryByText("Not saved yet")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    expect(save()).toBeEnabled();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
  });
  it("sending only: the sending action gets exactly the two settings; the other two are not called", async () => {
    const a = view();
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    fireEvent.change(pill("At most … messages per customer a day"), {
      target: { value: "5" },
    });
    await press();
    expect(a.saveSending).toHaveBeenCalledWith({
      auto_send_enabled: true,
      per_customer_daily_limit: 5,
    });
    expect(a.saveQuietHours).not.toHaveBeenCalled();
    expect(a.saveReminders).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved. Automatic sending is on.",
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
  it("quiet hours only: saved with the sending values on record", async () => {
    const a = view(actions(), {
      auto_send_enabled: true,
      per_customer_daily_limit: 4,
    });
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "22" },
    });
    fireEvent.change(pill("Stay quiet from … to … (India time) (2)"), {
      target: { value: "8" },
    });
    await press();
    expect(a.saveQuietHours).toHaveBeenCalledWith({
      quiet_hours_start: 22,
      quiet_hours_end: 8,
      auto_send_enabled: true,
      per_customer_daily_limit: 4,
    });
    expect(a.saveSending).not.toHaveBeenCalled();
    expect(a.saveReminders).not.toHaveBeenCalled();
  });
  it("reminders only: the whole set at once, as the old form sent it (switch off keeps its hour)", async () => {
    const a = view(actions(), {}, schedulerSettings({ is_default: false }));
    fireEvent.change(pill("Remind visitors …"), { target: { value: "19" } });
    fireEvent.change(pill("Send a heads-up …"), { target: { value: "off" } });
    fireEvent.change(pill("Mark a visit as did-not-come …"), {
      target: { value: "60" },
    });
    await press();
    expect(a.saveReminders).toHaveBeenCalledWith({
      reminder_evening_enabled: true,
      reminder_evening_hour: 19,
      reminder_heads_up_enabled: false,
      reminder_heads_up_minutes: 120,
      no_show_enabled: true,
      no_show_after_minutes: 60,
    });
    expect(a.saveSending).not.toHaveBeenCalled();
    expect(a.saveQuietHours).not.toHaveBeenCalled();
  });
  it("all three changed: sending, then quiet hours with the NEW sending values, then reminders; every message is shown", async () => {
    const a = view();
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    fireEvent.change(pill("At most … messages per customer a day"), {
      target: { value: "6" },
    });
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "23" },
    });
    fireEvent.change(pill("Send a heads-up …"), { target: { value: "90" } });
    await press();
    expect(a.saveSending).toHaveBeenCalledWith({
      auto_send_enabled: true,
      per_customer_daily_limit: 6,
    });
    expect(a.saveQuietHours).toHaveBeenCalledWith({
      quiet_hours_start: 23,
      quiet_hours_end: 9,
      auto_send_enabled: true,
      per_customer_daily_limit: 6,
    });
    expect(a.saveReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        reminder_heads_up_minutes: 90,
        reminder_heads_up_enabled: true,
      }),
    );
    expect(screen.getAllByRole("status")).toHaveLength(3);
  });
  it("without the second factor it says so, points at Security, keeps every choice and stops after the first refusal", async () => {
    const a = view(actions({ saveSending: mfa() }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "22" },
    });
    await press();
    expect(
      within(screen.getByRole("alert")).getByRole("link", {
        name: "Open Security",
      }),
    ).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This needs your two-step code, if you turned it on. Nothing was changed.",
    );
    expect(
      screen.getByRole("checkbox", { name: /Let my assistant/ }),
    ).toBeChecked();
    expect(pill("Stay quiet from … to … (India time) (1)")).toHaveValue("22");
    expect(a.saveQuietHours).not.toHaveBeenCalled();
    expect(save()).toBeEnabled();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
  });
  it("a part saved before a refusal stays saved: only the refused part is sent again", async () => {
    const a = view(actions({ saveQuietHours: mfa() }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "22" },
    });
    await press();
    expect(a.saveSending).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved. Automatic sending is on.",
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await press();
    expect(a.saveSending).toHaveBeenCalledTimes(1);
    expect(a.saveQuietHours).toHaveBeenCalledTimes(2);
    expect(a.saveQuietHours).toHaveBeenLastCalledWith({
      quiet_hours_start: 22,
      quiet_hours_end: 9,
      auto_send_enabled: true,
      per_customer_daily_limit: 3,
    });
  });
  it("an action that throws says our generic sentence, and a double press saves once while the first is out", async () => {
    let finish!: (v: { ok: true; message: string }) => void;
    const slow = vi.fn(
      () => new Promise<{ ok: true; message: string }>((r) => (finish = r)),
    );
    view(actions({ saveSending: slow }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    await press();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Working…" })),
    );
    await act(async () => finish({ ok: true, message: "Saved." }));
    expect(slow).toHaveBeenCalledTimes(1);
    cleanup();
    view(
      actions({
        saveSending: vi.fn(async () => Promise.reject(new Error("x"))),
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Let my assistant/ }));
    await press();
    expect(screen.getByRole("alert")).toHaveTextContent(/./);
  });
  it("without the reminders (not readable) the sending and quiet hours still work and the reminder block says Not available yet", async () => {
    const a = view(actions(), {}, null);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(document.querySelector('[data-part="auto-more"]')).toBeNull();
    fireEvent.change(pill("Stay quiet from … to … (India time) (1)"), {
      target: { value: "23" },
    });
    await press();
    expect(a.saveQuietHours).toHaveBeenCalledTimes(1);
    expect(a.saveReminders).not.toHaveBeenCalled();
  });
});
