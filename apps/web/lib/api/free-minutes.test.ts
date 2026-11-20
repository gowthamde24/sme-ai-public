import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./client";
import { keepFreeMinutes } from "./free-minutes";

const err = (code = "free_minutes_used_up") => new ApiRequestError(409, code, "x");

describe("C1's 409 free_minutes_used_up: the free minutes and the day they restart", () => {
  it("keeps an integer number of minutes and a date, from the error or the top of the body", () => {
    const a = err();
    keepFreeMinutes(a, { error: { code: "free_minutes_used_up", minutes: 500, restarts_on: "2026-12-01T00:00:00+05:30" } });
    expect(a.extra).toEqual({ free: { minutes: 500, restartsOn: "2026-12-01" } });
    const b = err();
    keepFreeMinutes(b, { minutes: 500, restarts_on: "2026-12-01" });
    expect(b.extra).toEqual({ free: { minutes: 500, restartsOn: "2026-12-01" } });
  });
  it("keeps nothing for a text, a negative or fractional number, no date, another code or no body", () => {
    for (const body of [{ error: { minutes: "500", restarts_on: "2026-12-01" } }, { minutes: -1, restarts_on: "2026-12-01" }, { minutes: 1.5, restarts_on: "2026-12-01" }, { minutes: 500, restarts_on: "soon" }, { minutes: 500 }, null, "x"]) {
      const e = err();
      keepFreeMinutes(e, body);
      expect(e.extra, JSON.stringify(body)).toBeUndefined();
    }
    const other = err("call_not_allowed");
    keepFreeMinutes(other, { minutes: 500, restarts_on: "2026-12-01" });
    expect(other.extra).toBeUndefined();
  });
});
