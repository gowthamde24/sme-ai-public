import { describe, expect, it } from "vitest";

import { convLangOf, formatWhen } from "./format-when";

const TODAY = "2026-11-14";
describe("the time phrase of a plan card", () => {
  it("one point in time reads naturally in each language", () => {
    const at = { date: TODAY, fromMinute: 18 * 60, toMinute: null };
    expect(formatWhen(at, "te", TODAY)).toBe("ఈ రోజు సాయంత్రం 6 గంటలకి");
    expect(formatWhen(at, "hi", TODAY)).toBe("आज शाम 6 बजे");
    expect(formatWhen(at, "kn", TODAY)).toBe("ಇಂದು ಸಂಜೆ 6 ಗಂಟೆಗೆ");
    expect(formatWhen(at, "en", TODAY)).toBe("today, 6 pm");
  });
  it("a stretch says both ends, and a half hour keeps its minutes", () => {
    const span = { date: "2026-11-15", fromMinute: 10 * 60, toMinute: 19 * 60 };
    expect(formatWhen(span, "te", TODAY)).toBe("రేపు ఉదయం 10 నుండి సాయంత్రం 7 వరకు");
    expect(formatWhen(span, "en", TODAY)).toBe("tomorrow, 10 am to 7 pm");
    expect(formatWhen({ date: TODAY, fromMinute: 10 * 60 + 30, toMinute: null }, "en", TODAY)).toBe("today, 10:30 am");
  });
  it("another day is its date; noon is 12 pm and midnight 12 am; an end that is not after the start is a single time", () => {
    expect(formatWhen({ date: "2026-11-20", fromMinute: 12 * 60, toMinute: null }, "en", TODAY)).toBe("20 Nov, 12 pm");
    expect(formatWhen({ date: TODAY, fromMinute: 0, toMinute: null }, "en", TODAY)).toBe("today, 12 am");
    expect(formatWhen({ date: TODAY, fromMinute: 600, toMinute: 600 }, "en", TODAY)).toBe("today, 10 am");
  });
  it("a language without words yet (ta, ml, mr) reads in English", () => {
    expect(convLangOf("ta")).toBe("en");
    expect(convLangOf("te")).toBe("te");
    expect(formatWhen({ date: TODAY, fromMinute: 18 * 60, toMinute: null }, "mr", TODAY)).toBe("today, 6 pm");
  });
});
