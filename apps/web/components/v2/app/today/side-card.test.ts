import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SIDE_CARD, SIDE_LINE, SIDE_LINK, SIDE_TITLE } from "./side-card";

describe("the four cards leave no hole (owner, 1 Nov)", () => {
  it("a card alone in its last row spans the full width and is one compact row", () => {
    expect(SIDE_CARD).toContain("lg:[&:nth-child(odd):last-child]:col-span-2");
    expect(SIDE_CARD).toContain("lg:[&:nth-child(odd):last-child]:flex-row");
    for (const part of [SIDE_TITLE, SIDE_LINE, SIDE_LINK]) expect(part).toContain("lg:group-[:nth-child(odd):last-child]/side:");
    expect(SIDE_CARD).toContain("group/side");
  });
  it("the class names are written out in full: the style scanner never sees names put together from pieces", () => {
    const source = readFileSync(path.join(__dirname, "side-card.ts"), "utf8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"));
    expect(source.join("\n")).not.toContain("${");
  });
});
