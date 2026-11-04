import { describe, expect, it } from "vitest";

import { withVisitWords } from "./visit-words";

const base = (key: string, vars?: Record<string, string>) =>
  ({ "today.visits.title": "At the store today", "today.act.visit": "Offer a store visit", "today.act.visit.row": "Store visit", "today.visits.title.pack": `${vars?.visits} today`, "today.act.visit.pack": `${vars?.visit} instead`, "x": "x" })[key] ?? key;
const pack = (labels: Record<string, Record<string, string>>) => ({ labels });

describe("a business's own word for a visit (C1 #308)", () => {
  it("a builder: Site visits today, Site visit, Site visit instead; other words untouched", () => {
    const t = withVisitWords(base, pack({ en: { "word.visit": "Site visit", "word.visits": "Site visits" } }), "en");
    expect([t("today.visits.title"), t("today.act.visit.row"), t("today.act.visit"), t("x")]).toEqual(["Site visits today", "Site visit", "Site visit instead", "x"]);
  });
  it("a shop whose word is the plain 'Visit' keeps its store words", () => {
    const t = withVisitWords(base, pack({ en: { "word.visit": "Visit", "word.visits": "Visits" } }), "en");
    expect(t("today.visits.title")).toBe("At the store today");
  });
  it("no word in this language: the app's own words (never an English word on a Telugu screen); no pack: unchanged", () => {
    expect(withVisitWords(base, pack({ en: { "word.visit": "Test drive" } }), "te")("today.act.visit.row")).toBe("Store visit");
    expect(withVisitWords(base, pack({ en: { "word.visit": "Campus visit" }, te: { "word.visit": "క్యాంపస్ సందర్శన" } }), "te")("today.act.visit.row")).toBe("క్యాంపస్ సందర్శన");
    expect(withVisitWords(base, null, "en")("today.act.visit")).toBe("Offer a store visit");
  });
});
