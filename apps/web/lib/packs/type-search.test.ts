import { describe, expect, it } from "vitest";

import { LONG_LIST, searchTypes, searchWords, typeKeywords, type TypeRow } from "./type-search";

const rows: TypeRow[] = [
  { id: "textiles", name: "Textiles", line: "Sarees, fabric and garments", keywords: "saree sarees silk cotton handloom fabric cloth చీరలు" },
  { id: "kirana", name: "Kirana", line: "Grocery and daily needs", keywords: "grocery provision general store supermarket" },
  { id: "bakery", name: "Bakery", line: "Cakes, bread and sweets", keywords: "bakery cakes bread" },
  { id: "clinic", name: "Clinic", line: "Doctors and dental", keywords: "clinic dental hospital doctor" },
  { id: "other", name: "Other", line: "Something else", keywords: "" },
];

describe("the business-type search (owner, 26 Nov 2026)", () => {
  it("no search: every tile in the list's own order", () => {
    expect(searchTypes(rows, "").matches.map((r) => r.id)).toEqual(["textiles", "kirana", "bakery", "clinic", "other"]);
    expect(searchTypes(rows, " a ").searching).toBe(false); // one letter is too little
    expect(searchWords("Saree, silk!")).toEqual(["saree", "silk"]);
  });
  it("synonyms find the type: saree or silk -> Textiles, parlour is not there, dental -> Clinic", () => {
    expect(searchTypes(rows, "saree").matches.map((r) => r.id)).toEqual(["textiles"]);
    expect(searchTypes(rows, "silk").matches.map((r) => r.id)).toEqual(["textiles"]);
    expect(searchTypes(rows, "dental").matches.map((r) => r.id)).toEqual(["clinic"]);
    expect(searchTypes(rows, "groc").matches.map((r) => r.id)).toEqual(["kirana"]); // the start of a word
  });
  it("a name in another language finds it too; matches come first, best first, the rest after", () => {
    expect(searchTypes(rows, "చీరలు").matches.map((r) => r.id)).toEqual(["textiles"]);
    const r = searchTypes(rows, "bread cakes");
    expect(r.matches.map((x) => x.id)).toEqual(["bakery"]);
    expect(r.rest.map((x) => x.id)).toEqual(["textiles", "kirana", "clinic", "other"]);
  });
  it("every typed word has to match; nothing matching is an empty list", () => {
    expect(searchTypes(rows, "saree bakery").matches).toEqual([]);
    expect(searchTypes(rows, "spaceship").matches).toEqual([]);
    expect(searchTypes(rows, "spaceship").searching).toBe(true);
  });
  it("the synonyms of a type are its catalogue words and its name in every language; a list is long above twelve", () => {
    expect(typeKeywords({ names: { en: "Textiles", te: "వస్త్రాలు" }, keywords: "saree silk" })).toBe("saree silk Textiles వస్త్రాలు");
    expect(LONG_LIST).toBe(12);
  });
});
