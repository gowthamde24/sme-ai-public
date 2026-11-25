import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cellsOf, counts, fabricIn, parseSheetText, restatus, rowsFromCells, rupeesFrom } from "./sheet-parse";

const CSV = readFileSync(path.resolve(__dirname, "__fixtures__/sarees.csv"), "utf8");

describe("a saree shop's sheet", () => {
  it("reads prices the way a shop writes them", () => {
    for (const [text, rupees] of [["₹24,500", 24500], ["Rs. 6,200/-", 6200], ["18500", 18500], ["4,100", 4100], ["INR 3500", 3500], ["2.5k", 2500], ["4,100.50", 4101], ["rupees 900 only", 900]] as const) expect(rupeesFrom(text), text).toBe(rupees);
    for (const text of ["", "2 thousand 5 hundred", "call", "1000-1500", "₹", "12abc"]) expect(rupeesFrom(text), text).toBeNull();
  });
  it("splits commas, tabs, semicolons, quotes and a byte-order mark", () => {
    expect(cellsOf('﻿Name;Price\n"Kanchi; pattu";"24,500"\n')).toEqual([["Name", "Price"], ["Kanchi; pattu", "24,500"]]);
    expect(cellsOf("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(cellsOf('x,"say ""hi"""\n')).toEqual([["x", 'say "hi"']]);
  });
  it("finds the columns by their words, in any order and in four languages", () => {
    const p = parseSheetText("Colour,Qty,Rate,Saree\nRed,5,24500,Kanchi pattu\n");
    expect(p.headerFound).toBe(true);
    expect(p.rows[0]).toMatchObject({ name: "Kanchi pattu", price: 24500, count: 5, colour: "red", status: "ok" });
    const te = parseSheetText("పేరు,ధర\nకంచి పట్టు,24500\n");
    expect(te.rows[0]).toMatchObject({ name: "కంచి పట్టు", price: 24500 });
    const hi = parseSheetText("नाम,कीमत,स्टॉक\nबनारसी,9800,3\n");
    expect(hi.rows[0]).toMatchObject({ name: "बनारसी", price: 9800, count: 3 });
  });
  it("reads a sheet with no header as name then price", () => {
    const p = parseSheetText("Uppada cotton,4100\nChanderi,2500\n");
    expect(p.headerFound).toBe(false);
    expect(p.rows.map((r) => [r.name, r.price])).toEqual([["Uppada cotton", 4100], ["Chanderi", 2500]]);
  });
  it("gives each row of a real-looking sheet ONE plain status", () => {
    const p = parseSheetText(CSV);
    expect(p.rows).toHaveLength(10);
    const by = Object.fromEntries(p.rows.map((r) => [r.name, r.status]));
    expect(p.rows[0].status).toBe("ok"); // the first of the two with this name
    void by;
    expect(p.rows[7].status).toBe("duplicate"); // the second "Kanchi pattu bridal red"
    expect(by["Cotton saree daily wear"]).toBe("no_price");
    expect(by["Chanderi plain"]).toBe("bad_price"); // "2 thousand 5 hundred" is words
    expect(counts(p.rows)).toEqual({ ready: 7, fix: 2, skipped: 1 });
  });
  it("recomputes after a correction: a fixed price is ready, a removed twin frees the other", () => {
    const p = parseSheetText(CSV);
    const fixed = p.rows.map((r) => (r.name === "Chanderi plain" ? { ...r, priceText: "2,500" } : r));
    expect(counts(restatus(fixed)).fix).toBe(1);
    const noTwin = restatus(p.rows.filter((_, i) => i !== 0));
    expect(noTwin.find((r) => r.name === "Kanchi pattu bridal red")?.status).toBe("ok");
  });
  it("says why nothing came out, and cuts a very long sheet at 200", () => {
    expect(rowsFromCells([]).error).toBe("empty");
    expect(parseSheetText("Name,Price\n").error).toBe("no_rows");
    const long = parseSheetText(["Name,Price", ...Array.from({ length: 230 }, (_, i) => `Saree ${i},${1000 + i}`)].join("\n"));
    expect(long.rows).toHaveLength(200);
    expect(long.cut).toBe(true);
  });
  it("takes the fabric from the name, else 'other'", () => {
    expect(fabricIn("Kanchi pattu bridal red")).toBe("kanchi_pattu");
    expect(fabricIn("Dharmavaram silk maroon")).toBe("dharmavaram_silk");
    expect(fabricIn("Printed saree")).toBe("other");
  });
});
