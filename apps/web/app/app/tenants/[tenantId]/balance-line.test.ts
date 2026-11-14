import { describe, expect, it } from "vitest";

import { balanceLine } from "./today-data";

describe("the balance row on Today", () => {
  it("says the amount and the minutes, never 'credits'", () => {
    expect(balanceLine({ text: "₹1,050", minutesEstimate: 233 })).toBe("₹1,050 left · about 233 call minutes · Top up");
    expect(balanceLine({ text: "₹1,050", minutesEstimate: null })).toBe("₹1,050 left · Top up");
    expect(balanceLine({ text: "₹50", minutesEstimate: 10 })).not.toMatch(/credit/i);
  });
});
