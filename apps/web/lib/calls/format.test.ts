import { describe, expect, it } from "vitest";

import { clockShort, rupeeCost } from "./format";

describe("how the Calls page writes a length and a cost", () => {
  it("a length is minutes and seconds with no leading zero on the minutes", () => {
    expect([0, 5, 62, 252, 3725, -3].map(clockShort)).toEqual(["0:00", "0:05", "1:02", "4:12", "62:05", "0:00"]);
  });
  it("a cost has one decimal when there are paise, none for a whole rupee, two when the paise need them", () => {
    expect([0, 1000, 2250, 450, 1750, 253, 2_450_000].map(rupeeCost)).toEqual(["₹0", "₹10", "₹22.5", "₹4.5", "₹17.5", "₹2.53", "₹24,500"]);
  });
});
