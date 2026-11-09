import { describe, expect, it } from "vitest";

import { parseDay } from "@/lib/api/ai-team";
import { aiTeamDayFixture } from "@/lib/api/ai-team-fixtures";

import { axisOf, clockOf, dayList, duration, minuteOfDay, pct, rupees, shown, statusWords } from "./shift";

const day = parseDay(aiTeamDayFixture({ date: "2026-11-06" }));

describe("the shift as the screen draws it", () => {
  it("reads times in India time, whatever the browser's zone", () => {
    expect(minuteOfDay("2026-11-06T10:42:07+05:30")).toBe(642);
    expect(minuteOfDay("2026-11-06T05:12:07Z")).toBe(642);
    expect(clockOf("2026-11-06T16:00:00+05:30")).toBe("16:00");
    expect(duration(84)).toBe("1:24");
    expect(rupees(18450)).toBe("₹184.50");
    expect(rupees(12500000)).toBe("₹1,25,000");
  });
  it("the axis is the working day, widened to the hour for a mark or the now line outside it", () => {
    const axis = axisOf(day, 14 * 60 + 12);
    expect([axis.start, axis.end]).toEqual([540, 1200]);
    expect(axis.hours[0]).toBe(540);
    expect(pct(axis, 540)).toBe(0);
    expect(pct(axis, 1200)).toBe(100);
    expect(axisOf(day, 21 * 60 + 5).end).toBe(22 * 60);
    const early = { ...day, lanes: [{ ...day.lanes[0], marks: [{ ...day.lanes[0].marks[0], t: "2026-11-06T07:30:00+05:30" }] }] };
    expect(axisOf(early, null).start).toBe(7 * 60);
  });
  it("a ⚑ from an earlier day is pinned at the start, before the day's marks", () => {
    const axis = axisOf(day, null);
    const old = { ...day, lanes: [{ ...day.lanes[4], marks: [...day.lanes[4].marks, { ...day.lanes[4].marks[0], id: "old", t: "2026-11-05T17:00:00+05:30", needsOwner: true }] }] };
    const list = dayList(old, axis, null);
    expect(list[0]).toMatchObject({ id: "old", before: true, minute: axis.start });
  });
  it("the flow strip filters by its step's kinds", () => {
    const caller = day.lanes.find((l) => l.helper === "caller")!;
    expect(shown(caller.marks, "called").every((m) => m.kind === "call")).toBe(true);
    expect(shown(caller.marks, "orders")).toEqual([]);
    expect(shown(caller.marks, null)).toHaveLength(caller.marks.length);
  });
  it("the live status in words: paused first, a call's timer, what's due next, what waits for you", () => {
    expect(statusWords({ kind: "paused", textKey: "paused", count: 2, at: null, who: null, since: null }, null)).toEqual({ key: "aiteam.status.paused.waiting", vars: { count: "2" } });
    expect(statusWords({ kind: "busy", textKey: "on_call", count: null, at: null, who: "Ramesh", since: "x" }, 42)).toEqual({ key: "aiteam.status.on_call", vars: { who: "Ramesh", time: "0:42" } });
    expect(statusWords({ kind: "due", textKey: "due_next", count: 5, at: "2026-11-06T16:00:00+05:30", who: null, since: null }, null)).toEqual({ key: "aiteam.status.due_next", vars: { count: "5", time: "16:00" } });
    expect(statusWords({ kind: "waiting", textKey: "waiting_for_you", count: 1, at: null, who: null, since: null }, null)?.key).toBe("aiteam.status.waiting_for_you");
    expect(statusWords(null, null)).toBeNull();
  });
});
