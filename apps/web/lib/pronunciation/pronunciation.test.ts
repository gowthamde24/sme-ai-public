import { describe, expect, it } from "vitest";

import { cleanText, offerFromBusiness, parseEntry, parseList } from "./types";

const row = { id: "11111111-1111-4111-8111-111111111111", word: "Pochampally", sounds_like: "pochampalli", language: null };

describe("the pronunciation list shapes", () => {
  it("reads an entry and a list, dropping unreadable suggestions but never an unreadable entry", () => {
    expect(parseEntry(row)).toEqual({ id: row.id, word: "Pochampally", soundsLike: "pochampalli", language: null });
    expect(parseEntry({ ...row, language: "te" })?.language).toBe("te");
    expect(parseEntry({ ...row, language: "xx" })).toBeNull();
    expect(parseEntry({ ...row, sounds_like: "" })).toBeNull();
    expect(parseList({ items: [row], suggestions: [{ word: "Kallu", reason: "business_name" }, { word: "x", reason: "nope" }, 5] })).toEqual({ items: [{ id: row.id, word: "Pochampally", soundsLike: "pochampalli", language: null }], suggestions: [{ word: "Kallu", reason: "business_name" }] });
    expect(parseList({ items: [{ ...row, id: "!" }] })).toBeNull();
    expect(parseList({ nope: 1 })).toBeNull();
  });
  it("cleans a word: trimmed, one line, 1..max characters, nothing that looks like markup", () => {
    expect(cleanText("  Kallu \n Sarees ", 60)).toBe("Kallu Sarees");
    expect(cleanText("", 60)).toBeNull();
    expect(cleanText("a".repeat(61), 60)).toBeNull();
    expect(cleanText("<break/>", 60)).toBeNull();
    expect(cleanText(4, 60)).toBeNull();
  });
  it("offers the words of the business name and town that are not taught yet", () => {
    const have = [{ id: "a", word: "kallu", soundsLike: "kallu", language: null }];
    const out = offerFromBusiness("Kallu Silks & Sarees 24", "Ananthapuramu", have, [{ word: "Uppada", reason: "product" }]);
    expect(out.map((s) => s.word)).toEqual(["Uppada", "Silks", "Sarees", "Ananthapuramu"]);
    expect(out.find((s) => s.word === "Ananthapuramu")?.reason).toBe("city");
  });
});
