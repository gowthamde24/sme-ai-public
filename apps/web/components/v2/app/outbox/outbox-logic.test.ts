import { describe, expect, it } from "vitest";

import { appT } from "@/i18n/app";
import { OUTBOX_REASONS } from "@/lib/api/outbox";

import { NOW } from "./outbox-test-kit";
import { parseFilters, presetDates, stamp } from "./outbox-time";
import { TABS, firstLine, reasonKey, toneOf } from "./reasons";
import { STALE_AFTER_MINUTES, schedulerView } from "./scheduler-line";

describe("the reason chips", () => {
  it("every reason the API can send has a plain-words chip in the string store, in four languages", () => {
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const t = appT(lang);
      for (const r of OUTBOX_REASONS) expect(t(reasonKey(r) as "frame.notyet").length, `${lang} ${r}`).toBeGreaterThan(2);
    }
  });
  it("says the reasons the brief asks for in plain words", () => {
    const t = appT("en");
    expect(t("outbox.reason.money")).toBe("Mentions a price");
    expect(t("outbox.reason.quiet_hours")).toBe("Quiet hours");
    expect(t("outbox.reason.stopped")).toBe("Customer said STOP");
    expect(t("outbox.reason.no_opt_in")).toBe("No WhatsApp opt-in");
    expect(t("outbox.reason.daily_limit")).toBe("Daily limit reached");
  });
  it("the colour follows the state: amber waits, blue held, green sent, red blocked or failed", () => {
    expect(toneOf({ status: "needs_approval" })).toContain("amber");
    expect(toneOf({ status: "queued" })).toContain("info");
    expect(toneOf({ status: "sent" })).toContain("green");
    expect(toneOf({ status: "blocked" })).toContain("red");
    expect(toneOf({ status: "failed" })).toContain("red");
  });
  it("the four tabs are the API's own names", () => {
    expect(TABS).toEqual(["waiting", "scheduled", "sent", "blocked"]);
  });
  it("the first line skips blank lines and trims", () => {
    expect(firstLine("\n  Hello there \nSecond")).toBe("Hello there");
    expect(firstLine("")).toBe("");
  });
});

describe("the times of the Outbox, in the Indian day", () => {
  it("a time today is the clock; another day is the day and the clock", () => {
    expect(stamp("2026-10-14T03:30:00Z", NOW)).toBe("9:00");
    expect(stamp("2026-10-13T15:45:00Z", NOW)).toBe("13 Oct, 21:15");
    expect(stamp("2026-10-14T18:45:00Z", NOW)).toBe("15 Oct, 0:15"); // past midnight in India is tomorrow
  });
});

describe("the filters in the address", () => {
  it("reads the customer and two real India dates; anything else is dropped", () => {
    expect(parseFilters({ q: "  Lakshmi ", from: "2026-10-01", to: "2026-10-04" }, NOW)).toEqual({ q: "Lakshmi", from: "2026-10-01", to: "2026-10-04" });
    expect(parseFilters({ from: "2026-02-30", to: "yesterday" }, NOW)).toEqual({ q: "", from: null, to: null });
    expect(parseFilters({ q: "x".repeat(300) }, NOW).q).toHaveLength(100);
    expect(parseFilters({ q: ["a", "b"] }, NOW).q).toBe("a");
  });
  it("a 'to' before the 'from' is dropped (the API would refuse it)", () => {
    expect(parseFilters({ from: "2026-10-05", to: "2026-10-01" }, NOW)).toEqual({ q: "", from: "2026-10-05", to: null });
  });
  it("an older link's range=today or range=7d becomes dates in the Indian day", () => {
    expect(parseFilters({ range: "today" }, NOW)).toEqual({ q: "", from: "2026-10-14", to: "2026-10-14" });
    expect(parseFilters({ range: "7d" }, NOW)).toEqual({ q: "", from: "2026-10-08", to: "2026-10-14" });
    expect(parseFilters({ range: "7d", from: "2026-10-01" }, NOW).from).toBe("2026-10-01");
  });
  it("the quick choices are today, and today with the six days before it (the Indian day, even just after midnight)", () => {
    const { today, week } = presetDates(NOW);
    expect(today).toEqual({ q: "", from: "2026-10-14", to: "2026-10-14" });
    expect(week).toEqual({ q: "", from: "2026-10-08", to: "2026-10-14" });
    expect(presetDates(Date.parse("2026-10-13T18:31:00Z")).today.from).toBe("2026-10-14");
  });
});

describe("how Vijaya's checking looks", () => {
  const s = { platform_switch_on: true, auto_send_enabled: true, active: true, last_run_at: "2026-10-14T04:28:00Z", next_run_at: "2026-10-14T04:29:00Z" };
  it("calm when it checked a moment ago", () => {
    expect(schedulerView(s, NOW)).toEqual({ state: "calm", minutes: 2, next: "2026-10-14T04:29:00Z", off: null });
  });
  it(`stale only when it should be working and has been quiet for more than ${STALE_AFTER_MINUTES} minutes`, () => {
    expect(schedulerView({ ...s, last_run_at: "2026-10-14T04:25:00Z" }, NOW)).toMatchObject({ state: "calm", minutes: 5 });
    expect(schedulerView({ ...s, last_run_at: "2026-10-14T04:24:00Z" }, NOW)).toEqual({ state: "stale", minutes: 6 });
  });
  it("a late check is not a warning while its automatic work is off (it has nothing to do), and says why", () => {
    const old = { ...s, last_run_at: "2026-10-14T00:00:00Z", active: false };
    expect(schedulerView({ ...old, auto_send_enabled: false }, NOW)).toMatchObject({ state: "calm", off: "business" });
    expect(schedulerView({ ...old, platform_switch_on: false }, NOW)).toMatchObject({ state: "calm", off: "system" });
  });
  it("never heard from", () => {
    expect(schedulerView({ ...s, last_run_at: null, next_run_at: null }, NOW)).toEqual({ state: "never", off: null });
  });
  it("a clock a little ahead of the server's is 0 minutes, not negative", () => {
    expect(schedulerView({ ...s, last_run_at: "2026-10-14T04:31:00Z" }, NOW)).toMatchObject({ minutes: 0 });
  });
});
