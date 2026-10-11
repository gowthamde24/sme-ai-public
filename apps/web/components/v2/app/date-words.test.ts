import { describe, expect, it } from "vitest";

import { dateText, dayText, weekdayWord } from "./date-words";
import { dayHeading, dayShort, indiaDayText, weekdayName } from "./visits/dates";
import { stamp } from "./outbox/outbox-time";
import { dayLine } from "./today/TodayView";

describe("dates in words of our own (the same text on the server and in the browser)", () => {
  it("English is written the way it always was", () => {
    expect(dayHeading("2026-10-14", "en")).toBe("Wednesday, 14 October 2026");
    expect(dayShort("2026-10-14", "en")).toBe("Wed, 14 Oct");
    expect(indiaDayText("2026-10-02T04:30:00Z", "en")).toBe("2 Oct 2026");
    expect(weekdayName(0, "en")).toBe("Monday");
    expect(dayLine(Date.parse("2026-10-11T05:00:00Z"), "en")).toBe("Sunday, 11 October");
  });

  it("October in Hindi is spelled one way, not two: the server (Node) and the browser (Chrome) used to disagree, which broke hydration", () => {
    expect(dayShort("2026-10-13", "hi")).toBe("मंगल, 13 अक्टू॰");
    expect(dayText("hi", 2026, 10, 13, { month: "short" })).toBe("13 अक्टू॰");
    expect(stamp("2026-10-12T15:45:00Z", Date.parse("2026-10-14T04:30:00Z"), "hi")).toBe("12 अक्टू॰, 21:15");
  });

  it("each language orders weekday, day and month its own way", () => {
    expect(dateText("te", 2026, 9, 13, 1, { weekday: "short", month: "short" })).toBe("13 అక్టో, మంగళ");
    expect(dateText("kn", 2026, 9, 13, 1, { weekday: "short", month: "short" })).toBe("ಮಂಗಳ, 13 ಅಕ್ಟೋ");
    expect(dayHeading("2026-10-14", "te")).toBe("14 అక్టోబర్ 2026, బుధవారం");
  });

  it("has all twelve months and seven weekdays in every language, none empty and none repeated", () => {
    for (const lang of ["en", "te", "hi", "kn"]) {
      const long = Array.from({ length: 12 }, (_, i) => dayText(lang, 2026, i + 1, 1, { month: "long" }));
      expect(new Set(long).size, lang).toBe(12);
      expect(new Set(Array.from({ length: 7 }, (_, i) => weekdayWord(lang, i))).size, lang).toBe(7);
      for (const w of long) expect(w.length).toBeGreaterThan(3);
    }
  });

  it("an unknown language is English; a date that is not a date is returned as it came", () => {
    expect(dayShort("2026-10-14", "ta")).toBe("Wed, 14 Oct");
    expect(dayShort("not a day", "en")).toBe("not a day");
  });

  it("does not use the runtime's own date data (no Intl)", async () => {
    const src = (await import("node:fs")).readFileSync(`${import.meta.dirname}/date-words.ts`, "utf8");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/Intl\./);
  });
});
