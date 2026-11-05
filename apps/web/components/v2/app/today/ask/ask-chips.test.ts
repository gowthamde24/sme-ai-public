import { describe, expect, it } from "vitest";

import { TODAY_CHIPS, todayChips } from "./ask-chips";

describe("Today's four chips (sidebar v2, owner 5 Nov)", () => {
  it("the three that always work, then one the workspace can really do: find customers, else add leads from a file, else the quotes that wait", () => {
    expect(todayChips({ finder: true, files: true })).toEqual([...TODAY_CHIPS, "ask.chip.find"]);
    expect(todayChips({ finder: false, files: true })).toEqual([...TODAY_CHIPS, "ask.chip.import"]);
    expect(todayChips({ finder: false, files: false })).toEqual([...TODAY_CHIPS, "ask.chip.quotes"]);
  });
});
