import { describe, expect, it } from "vitest";

import { ago, indiaClock, indiaDay, whenLabel } from "./time";

// 2026-10-11 03:30 UTC is 9:00 in India; the zone of the machine and its locale do not matter (the formatters name both).
const NINE = "2026-10-11T03:30:00Z";
const NOW = Date.parse("2026-10-11T05:00:00Z"); // 10:30 in India

describe("the Indian clock", () => {
  it("writes the hour without a leading zero, 24-hour", () => {
    expect(indiaClock(NINE)).toBe("9:00");
    expect(indiaClock("2026-10-11T12:35:00Z")).toBe("18:05");
    expect(indiaClock("2026-10-10T18:30:00Z")).toBe("0:00"); // India midnight
  });
  it("names the Indian day, not the UTC day", () => {
    expect(indiaDay("2026-10-10T18:29:00Z")).toBe("2026-10-10");
    expect(indiaDay("2026-10-10T18:30:00Z")).toBe("2026-10-11");
  });
  it("shows the clock for something from today and how long ago for anything older", () => {
    expect(whenLabel("2026-10-11T03:12:00Z", NOW)).toBe("8:42");
    expect(whenLabel("2026-10-10T16:30:00Z", NOW)).toBe("13h"); // 22:00 yesterday in India
    expect(whenLabel("2026-10-08T05:00:00Z", NOW)).toBe("3d");
  });
  it("ago is short and needs no words", () => {
    const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
    expect([ago(at(0.2), NOW), ago(at(28), NOW), ago(at(180), NOW), ago(at(3000), NOW)]).toEqual(["1m", "28m", "3h", "2d"]);
  });
});
