import { describe, expect, it } from "vitest";

import { parseList } from "./list";

describe("the pasted list", () => {
  it("reads a name and a number in either order, or just a number", () => {
    const r = parseList("Ravi Kumar, 98765 43210\n+91 98765 43211; Anitha\n9876543212\n\n  Suresh | (040) 2345 6789 ");
    expect(r.people).toEqual([{ name: "Ravi Kumar", phone: "98765 43210" }, { name: "Anitha", phone: "+91 98765 43211" }, { phone: "9876543212" }, { name: "Suresh", phone: "(040) 2345 6789" }]);
    expect(r.skipped).toBe(0);
    expect(r.tooMany).toBe(false);
  });
  it("counts a line with no usable number and never guesses one", () => {
    const r = parseList("Just a name\n12345\nRavi, 99999 99999 99999 99999");
    expect(r.people).toEqual([]);
    expect(r.skipped).toBe(3);
  });
  it("keeps at most 500 and says so", () => {
    const r = parseList(Array.from({ length: 503 }, (_, i) => `9876${String(100000 + i)}`).join("\n"));
    expect(r.people).toHaveLength(500);
    expect(r.tooMany).toBe(true);
  });
  it("cuts a long name", () => {
    expect(parseList(`${"x".repeat(200)}, 9876543210`).people[0].name).toHaveLength(80);
  });
});
