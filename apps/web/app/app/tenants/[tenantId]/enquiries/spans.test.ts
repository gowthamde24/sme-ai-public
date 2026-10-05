import { describe, expect, it } from "vitest";

import { segments } from "./spans";

describe("segments (the words a field cites, by code point)", () => {
  it("splits the text at the quote and keeps every character", () => {
    expect(segments("Need 20 sarees now", [{ start: 5, end: 7, id: "q" }])).toEqual([
      { text: "Need ", ids: [] },
      { text: "20", ids: ["q"] },
      { text: " sarees now", ids: [] },
    ]);
  });

  it("counts Unicode code points, not UTF-16 units (an emoji is one position)", () => {
    const body = "😀 20 sarees";
    expect(segments(body, [{ start: 2, end: 4, id: "q" }]).find((s) => s.ids.length)?.text).toBe("20");
    expect(segments(body, []).map((s) => s.text).join("")).toBe(body);
  });

  it("handles overlapping and nested quotes, one marked piece per distinct cover", () => {
    const parts = segments("abcdefgh", [{ start: 1, end: 5, id: "a" }, { start: 3, end: 7, id: "b" }]);
    expect(parts.map((p) => [p.text, p.ids])).toEqual([
      ["a", []], ["bc", ["a"]], ["de", ["a", "b"]], ["fg", ["b"]], ["h", []],
    ]);
  });

  it("ignores a span that is empty, negative, fractional or past the end, and never loses text", () => {
    const body = "Hello, world";
    const parts = segments(body, [{ start: 3, end: 3, id: "e" }, { start: -1, end: 4, id: "n" }, { start: 1.5, end: 4, id: "f" }, { start: 7, end: 500, id: "p" }]);
    expect(parts.map((p) => p.text).join("")).toBe(body);
    expect(parts.find((p) => p.ids.includes("p"))?.text).toBe("world");
    expect(parts.some((p) => p.ids.some((id) => ["e", "n", "f"].includes(id)))).toBe(false);
  });

  it("is safe for an empty body and keeps joiners and combining marks together", () => {
    expect(segments("", [{ start: 0, end: 3, id: "x" }]).map((s) => s.text).join("")).toBe("");
    const body = "క్ష సారీ";
    expect(segments(body, []).map((s) => s.text).join("")).toBe(body);
  });
});
