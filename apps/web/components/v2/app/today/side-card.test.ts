import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SIDE_CARD, SIDE_GRID, SIDE_LINE, SIDE_LINK, SIDE_TITLE } from "./side-card";

describe("the summary cards leave no hole (owner, 1 Nov; four in a row since 5 Nov)", () => {
  it("fill the row on a wide screen (as many as there are), two by two below, a card alone in its last row spans both", () => {
    expect(SIDE_GRID).toContain("xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]");
    expect(SIDE_GRID).toContain("sm:grid-cols-2");
    expect(SIDE_CARD).toContain("sm:[&:nth-child(odd):last-child]:col-span-2");
    expect(SIDE_CARD).toContain("xl:[&:nth-child(odd):last-child]:col-span-1");
    expect(SIDE_LINK).toContain("mt-auto"); // the links of a row line up
    void SIDE_TITLE;
    void SIDE_LINE;
  });
  it("the class names are written out in full: the style scanner never sees names put together from pieces", () => {
    const source = readFileSync(path.join(__dirname, "side-card.ts"), "utf8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"));
    expect(source.join("\n")).not.toContain("${");
  });
});
