import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ADR 0060 decision 5: the baseline of an empty route (Stage 0) plus 40 KB. Changing this needs the owner's approval, so
// the numbers are pinned here as well as in scripts/budget.json.
describe("scripts/budget.json", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(__dirname, "../budget.json"), "utf8"));
  it("is the ADR 0060 budget: 177,009 B baseline + 40,000 B", () => {
    expect(budget.baselineGzipBytes).toBe(177009);
    expect(budget.allowanceGzipBytes).toBe(40000);
    expect(budget.baselineGzipBytes + budget.allowanceGzipBytes).toBe(217009);
    expect(budget.route).toBe("/landing");
  });
});
