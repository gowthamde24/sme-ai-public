import { describe, expect, it } from "vitest";

import { hourWord, nextRunMs, parseRun, parseRuns, parseSweep, parseSweepList, skipKey, sweepProblem } from "./sweeps";

const ID = "5e1e0000-0000-4000-8000-000000000001";
const RUN = { id: "5e1e0000-0000-4000-8000-0000000000a1", sweep_id: ID, state: "done", skip_reason: null, search_id: "5e1e0000-0000-4000-8000-0000000000b1", started_at: "2026-11-09T01:30:00Z", finished_at: "2026-11-09T01:30:40Z", cost_paise: 0, counts: { found: 20, new: 6, duplicates: 14, needs_owner: 4 }, new_since_last_run: 6, trigger: "schedule" };
const SWEEP = { id: ID, query: "saree shops", area: "Jayanagar Bengaluru", category_hint: null, max_results: 20, weekday: 1, hour: 7, timezone: "Asia/Kolkata", enabled: true, provider: "fixture", est_cost_paise: 0, cost_is_estimate: false, attribution: null, next_run_at: "2026-11-16T01:30:00Z", last_run: RUN, created_by: ID, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };

describe("the weekly search's shapes (C1's proposal, docs/contracts/lead-finder-sweep.md)", () => {
  it("reads a sweep and its last run, counts the API leaves out are 0", () => {
    const s = parseSweep(SWEEP);
    expect(s).toMatchObject({ id: ID, query: "saree shops", area: "Jayanagar Bengaluru", maxResults: 20, weekday: 1, hour: 7, enabled: true, provider: "fixture", estCostPaise: 0, nextRunAt: "2026-11-16T01:30:00Z" });
    expect(s?.lastRun).toMatchObject({ state: "done", newSinceLastRun: 6, trigger: "schedule", counts: { found: 20, new: 6, duplicates: 14, callReady: 0, needsOwner: 4, skipped: 0 } });
  });
  it("a paused sweep has no next run, whatever was sent; a skipped run says why in a closed word", () => {
    expect(parseSweep({ ...SWEEP, enabled: false })?.nextRunAt).toBeNull();
    expect(parseRun({ ...RUN, state: "skipped", skip_reason: "budget", counts: null, new_since_last_run: 0 })).toMatchObject({ state: "skipped", skipReason: "budget", counts: null });
    expect(parseRun({ ...RUN, state: "skipped", skip_reason: "made_up_word" })?.skipReason).toBeNull();
  });
  it("what does not fit is dropped, an answer that is not a sweep is null", () => {
    expect(parseSweep({ ...SWEEP, weekday: 8 })).toBeNull();
    expect(parseSweep({ ...SWEEP, hour: 24 })).toBeNull();
    expect(parseSweep({ ...SWEEP, id: "../x" })).toBeNull();
    expect(parseSweep({ ...SWEEP, enabled: "yes" })).toBeNull();
    expect(parseSweep(null)).toBeNull();
    expect(parseRun({ ...RUN, state: "melted" })).toBeNull();
    expect(parseSweepList({ items: [SWEEP, { nope: 1 }], max_sweeps: 5, weekly_budget_paise: 0 })).toMatchObject({ items: [{ id: ID }], maxSweeps: 5, weeklyBudgetPaise: 0 });
    expect(parseSweepList({ items: "x" })).toBeNull();
    expect(parseRuns({ items: [RUN, 7] })).toHaveLength(1);
  });
  it("the form's rules are the API's: the words 2 to 300, the day 1 to 7, the hour 0 to 23, at most 1 to 20 results", () => {
    const ok = { text: "find new retailers in Jayanagar", language: "en", weekday: 1, hour: 7, maxResults: 20 };
    expect(sweepProblem(ok)).toBeNull();
    expect(sweepProblem({ ...ok, text: " a " })).toBe("empty");
    expect(sweepProblem({ ...ok, text: "x".repeat(301) })).toBe("too_long");
    expect(sweepProblem({ ...ok, weekday: 0 })).toBe("weekday");
    expect(sweepProblem({ ...ok, weekday: 8 })).toBe("weekday");
    expect(sweepProblem({ ...ok, hour: 24 })).toBe("hour");
    expect(sweepProblem({ ...ok, hour: 0 })).toBeNull();
    expect(sweepProblem({ ...ok, maxResults: 21 })).toBe("results");
    expect(sweepProblem({ ...ok, maxResults: 0 })).toBe("results");
    expect(sweepProblem({ ...ok, hour: 7.5 })).toBe("hour");
  });
  it("words: a skip reason has its key, an unknown one the calm general key; the hour is written as the calling hours are", () => {
    expect(skipKey("budget")).toBe("sw.skip.budget");
    expect(skipKey("provider_down")).toBe("sw.skip.provider_down");
    expect(skipKey("???")).toBe("sw.skip.other");
    expect(skipKey(null)).toBe("sw.skip.other");
    expect(hourWord(7)).toBe("07:00");
    expect(hourWord(18)).toBe("18:00");
  });
  it("the mock's next run is the same weekday and hour in India time, always ahead", () => {
    const now = Date.UTC(2026, 10, 11, 4, 0, 0); // Wed 11 Nov 2026 09:30 IST
    const monday = nextRunMs(1, 7, now);
    expect(new Date(monday).toISOString()).toBe("2026-11-16T01:30:00.000Z"); // Mon 16 Nov 07:00 IST
    expect(new Date(nextRunMs(3, 15, now)).toISOString()).toBe("2026-11-11T09:30:00.000Z"); // later today
    expect(new Date(nextRunMs(3, 9, now)).toISOString()).toBe("2026-11-18T03:30:00.000Z"); // 09:00 already passed: next week
    expect(nextRunMs(7, 0, now)).toBeGreaterThan(now);
  });
});
