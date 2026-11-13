import { describe, expect, it } from "vitest";

import { parseProgress } from "./outreach";

const WIRE = { total: 30, waiting: 10, done: 20, calls_made: 20, connected: 12, interested: 5, minutes_used: 60 };

describe("a list's progress", () => {
  it("reads the old answer without the results (nothing is invented)", () => {
    const p = parseProgress(WIRE);
    expect(p).toEqual({ total: 30, waiting: 10, done: 20, callsMade: 20, connected: 12, interested: 5, minutesUsed: 60 });
    expect("visitsBooked" in p).toBe(false);
  });
  it("reads the visits booked and the quotes in paise when the API says them, and null when it says null", () => {
    expect(parseProgress({ ...WIRE, visits_booked: 3, quotes_paise: 1_250_000 })).toMatchObject({ visitsBooked: 3, quotesPaise: 1_250_000 });
    expect(parseProgress({ ...WIRE, visits_booked: null, quotes_paise: null })).toMatchObject({ visitsBooked: null, quotesPaise: null });
  });
  it("refuses an odd number", () => {
    expect(() => parseProgress({ ...WIRE, visits_booked: -1 })).toThrow();
    expect(() => parseProgress({ ...WIRE, quotes_paise: "x" })).toThrow();
  });
});
