import { describe, expect, it } from "vitest";

import { festivalHint } from "./festival";
import { callLines, daysUntil, fillText, forSeason, textIn, type Festival, type PackJobs } from "./templates";
import { parsePackJobs } from "@/lib/api/job-templates";
import { wireNewJobSheet } from "./template-fixtures";

const own = parsePackJobs((wireNewJobSheet() as { own: unknown }).own);

describe("template words", () => {
  it("a text is in the person's language, and English when the language is missing", () => {
    const t = { en: "Hello", te: "హలో" };
    expect(textIn(t, "te")).toBe("హలో");
    expect(textIn(t, "kn")).toBe("Hello");
    expect(textIn(t, "xx")).toBe("Hello");
  });
  it("the four placeholders are filled; anything else stays as it is", () => {
    expect(fillText("Hi {customer}! {assistant}, the AI assistant of {business}. {item} {other}", { business: "Neelambari Silks", customer: "Lakshmi", item: "sarees", assistant: "Priya" })).toBe("Hi Lakshmi! Priya, the AI assistant of Neelambari Silks. sarees {other}");
  });
  it("Telugu letters with the shop's name in Latin letters (C1's Telugu is kept as it is)", () => {
    const call = own.templates.find((t) => t.id === "enquiry_call_right_away")!.call!;
    const filled = fillText(textIn(call, "te"), { business: "Neelambari Silks", customer: "Lakshmi", item: "కంచి పట్టు చీరలు", assistant: "Priya" });
    expect(filled).toMatch(/Priya/);
    expect(filled).toMatch(/Neelambari Silks/);
    expect(filled).toMatch(/[ఀ-౿]/);
    expect(callLines(filled)).toHaveLength(2);
  });
  it("a festival season finds its template (the first of the pack), none finds nothing", () => {
    expect(forSeason(own, "diwali")?.id).toBe("festival_collection");
    expect(forSeason(own, "none")).toBeNull();
    expect(forSeason({ ...own, templates: [] } as PackJobs, "diwali")).toBeNull();
  });
});

describe("the next festival (from the calendar, never written in the web)", () => {
  const now = new Date("2026-11-19T10:00:00");
  const f = (season: Festival["season"], name: string, date: string): Festival => ({ season, name: { en: name, te: `${name}-te` }, date });
  it("no calendar: no suggestion", () => {
    expect(festivalHint(null, "en", now)).toBeNull();
    expect(festivalHint([], "en", now)).toBeNull();
  });
  it("the NEAREST festival only (one row, not a list), in the person's language, with the days to go", () => {
    const hint = festivalHint([f("wedding_season", "Wedding season", "2026-12-20"), f("diwali", "Diwali", "2026-12-03"), f("new_year", "New year", "2027-01-01")], "te", now);
    expect(hint).toEqual({ season: "diwali", name: "Diwali-te", days: 14, date: "2026-12-03" });
  });
  it("a festival that is past or beyond the API's 60 days is not suggested; today counts; day 60 is the last", () => {
    expect(festivalHint([f("diwali", "Diwali", "2026-11-08")], "en", now)).toBeNull();
    expect(festivalHint([f("diwali", "Diwali", "2027-02-01")], "en", now)).toBeNull();
    expect(festivalHint([f("diwali", "Diwali", "2026-11-19")], "en", now)?.days).toBe(0);
    expect(festivalHint([f("wedding_season", "Wedding season", "2027-01-18")], "en", now)?.days).toBe(60);
    expect(festivalHint([f("wedding_season", "Wedding season", "2027-01-19")], "en", now)).toBeNull();
    expect(daysUntil("2026-11-26", new Date("2026-11-19T23:30:00+05:30"))).toBe(7);
    expect(daysUntil("2026-11-08T08:00:00Z", now)).toBe(-11);
  });
  it("the list the API sends (nearest first, one per season) shows its first row; a list in any other order still shows the nearest", () => {
    const rows = [f("diwali", "Diwali", "2026-12-03"), f("wedding_season", "Wedding season", "2026-12-20"), f("new_year", "New year", "2027-01-01")];
    expect(festivalHint(rows, "en", now)?.season).toBe("diwali");
    expect(festivalHint([...rows].reverse(), "en", now)?.season).toBe("diwali");
  });
  it("the day is the day in India, not the server's (UTC): at 20:00 UTC it is already tomorrow in India", () => {
    const evening = new Date("2026-11-18T20:00:00Z"); // 01:30 on 19 Nov in India
    expect(daysUntil("2026-11-19", evening)).toBe(0);
    expect(daysUntil("2026-11-20", evening)).toBe(1);
    expect(daysUntil("2026-11-18", evening)).toBe(-1);
    expect(festivalHint([f("diwali", "Diwali", "2026-11-19")], "en", evening)?.days).toBe(0);
    expect(daysUntil("2026-11-20", new Date("2026-11-19T18:29:00Z"))).toBe(1); // 23:59 in India: still 19 Nov
    expect(daysUntil("2026-11-20", new Date("2026-11-19T18:30:00Z"))).toBe(0); // midnight in India
  });
});
