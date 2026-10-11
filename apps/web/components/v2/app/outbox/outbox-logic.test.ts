import { describe, expect, it } from "vitest";

import { appT } from "@/i18n/app";
import { OUTBOX_REASONS } from "@/lib/api/outbox";

import { NOW } from "./outbox-test-kit";
import { filedAt, inRange, stamp } from "./outbox-time";
import { ALL_REASON_KEYS, TABS, TAB_STATUSES, firstLine, reasonKey, toneOf } from "./reasons";
import { STALE_AFTER_MINUTES, schedulerView } from "./scheduler-line";

describe("the reason chips", () => {
  it("every reason the API can send has a plain-words chip in the string store, in four languages", () => {
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const t = appT(lang);
      for (const r of OUTBOX_REASONS) expect(t(reasonKey(r) as "frame.notyet").length, `${lang} ${r}`).toBeGreaterThan(2);
    }
    expect(ALL_REASON_KEYS).toHaveLength(OUTBOX_REASONS.length);
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
  it("the four tabs cover every status exactly once", () => {
    expect(TABS).toEqual(["waiting", "scheduled", "sent", "blocked"]);
    expect(Object.values(TAB_STATUSES).flat().sort()).toEqual(["blocked", "failed", "needs_approval", "queued", "sent"]);
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
  it("files a message under when it goes out, when it went, or when it was made", () => {
    const m = { scheduled_for: "2026-10-15T03:30:00Z", sent_at: "2026-10-14T02:00:00Z", created_at: "2026-10-14T01:00:00Z" };
    expect(filedAt({ ...m, status: "queued" })).toBe(m.scheduled_for);
    expect(filedAt({ ...m, status: "sent" })).toBe(m.sent_at);
    expect(filedAt({ ...m, status: "blocked" })).toBe(m.created_at);
    expect(filedAt({ ...m, status: "queued", scheduled_for: null })).toBe(m.created_at);
  });
  it("'today' is the Indian day (including a held message that goes out later); '7 days' starts six days back", () => {
    expect(inRange("2026-10-14T00:00:00Z", "today", NOW)).toBe(true);
    expect(inRange("2026-10-13T18:29:00Z", "today", NOW)).toBe(false); // 23:59 on the 13th in India
    expect(inRange("2026-10-13T18:30:00Z", "today", NOW)).toBe(true); // 00:00 on the 14th in India
    expect(inRange("2026-10-15T03:30:00Z", "today", NOW)).toBe(true); // held for tomorrow 9:00
    expect(inRange("2026-10-08T00:00:00Z", "7d", NOW)).toBe(true);
    expect(inRange("2026-10-07T18:29:00Z", "7d", NOW)).toBe(false);
  });
});

describe("how Agent OWL's checking looks", () => {
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
