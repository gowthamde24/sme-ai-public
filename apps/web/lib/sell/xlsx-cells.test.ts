import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cellsOf } from "./sheet-parse";
import { xlsxCells, XlsxError } from "./xlsx-cells";

const FIX = (n: string) => path.resolve(__dirname, "__fixtures__", n);
const buf = (n: string) => { const b = readFileSync(FIX(n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe("an Excel file read in the browser", () => {
  it("gives the same cells as the CSV saved from it (text and numbers, empty cells kept in place)", async () => {
    const x = await xlsxCells(buf("sarees.xlsx"));
    const c = cellsOf(readFileSync(FIX("sarees.csv"), "utf8"));
    expect(x).toHaveLength(c.length);
    expect(x[1]).toEqual(c[1]);
    expect(x[5]).toEqual(c[5]); // an empty "Stock" cell stays an empty cell
    expect(x[7]).toEqual(c[7]); // an empty price
  });
  it("says it cannot read what is not an .xlsx (an old .xls, a text file, a damaged file)", async () => {
    await expect(xlsxCells(new TextEncoder().encode("a,b\n1,2").buffer as ArrayBuffer)).rejects.toBeInstanceOf(XlsxError);
    await expect(xlsxCells(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer as ArrayBuffer)).rejects.toBeInstanceOf(XlsxError);
  });
});
