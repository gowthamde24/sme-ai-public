import { describe, expect, it } from "vitest";

import { formatINR } from "@/design/format";

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(142000)).toBe("₹1,42,000");
    expect(formatINR(141750)).toBe("₹1,41,750");
  });
  it("shows paise on request and only when needed in auto mode", () => {
    expect(formatINR(7820, { decimals: 2 })).toBe("₹7,820.00");
    expect(formatINR(12.5)).toBe("₹12.50");
    expect(formatINR(12)).toBe("₹12");
  });
});
