import { describe, expect, it } from "vitest";

import { formatRupees as engineRupees } from "@quote-engine/construction";

import { areaText, formatRupees, formatRupeesShort, groupIndian, numberInWords, percentFromBps, rupeesInWords, rupeesToPaise } from "./money";

describe("rupees", () => {
  it.each([0, 5, 99, 100, 12345, 99999, 100000, 8879500, 123456789, 1234567890123, -250050])("prints %i paise exactly as the calculator package does", (p) => {
    expect(formatRupees(p)).toBe(engineRupees(p));
  });
  it("drops .00 in the short form", () => {
    expect(formatRupeesShort(8879500)).toBe("₹88,795");
    expect(formatRupeesShort(8879550)).toBe("₹88,795.50");
  });
  it("groups whole numbers the Indian way", () => {
    expect(groupIndian(4725)).toBe("4,725");
    expect(groupIndian(1250000)).toBe("12,50,000");
    expect(groupIndian(-1250000)).toBe("-12,50,000");
  });
  it("reads typed rupees into paise, or refuses", () => {
    expect(rupeesToPaise("1,250.50")).toBe(125050);
    expect(rupeesToPaise("₹ 900")).toBe(90000);
    expect(rupeesToPaise("0.5")).toBe(50);
    for (const bad of ["", "abc", "1.234", "-5", "1e5", "12 34 56x", "9999999999999"]) expect(rupeesToPaise(bad), bad).toBeNull();
    expect(rupeesToPaise("1000", 50_000)).toBeNull();
  });
});

describe("amounts in words", () => {
  it.each([
    [0, "Zero"],
    [7, "Seven"],
    [19, "Nineteen"],
    [21, "Twenty-One"],
    [100, "One Hundred"],
    [101, "One Hundred One"],
    [1000, "One Thousand"],
    [99999, "Ninety-Nine Thousand Nine Hundred Ninety-Nine"],
    [100000, "One Lakh"],
    [8879500, "Eighty-Eight Lakh Seventy-Nine Thousand Five Hundred"],
    [10000000, "One Crore"],
    [123456789, "Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine"],
  ])("%i is %s", (n, words) => expect(numberInWords(n)).toBe(words));
  it("writes an amount with paise", () => {
    expect(rupeesInWords(8879550)).toBe("Rupees Eighty-Eight Thousand Seven Hundred Ninety-Five and Fifty Paise Only");
    expect(rupeesInWords(7500000)).toBe("Rupees Seventy-Five Thousand Only");
    expect(rupeesInWords(5)).toBe("Rupees Zero and Five Paise Only");
  });
  it("refuses a negative or fractional amount", () => {
    expect(() => rupeesInWords(-1)).toThrow(RangeError);
    expect(() => rupeesInWords(1.5)).toThrow(RangeError);
  });
});

describe("small helpers", () => {
  it("basis points and areas", () => {
    expect(percentFromBps(1800)).toBe("18");
    expect(percentFromBps(250)).toBe("2.5");
    expect(percentFromBps(525)).toBe("5.25");
    expect(areaText(100000)).toBe("1,000");
    expect(areaText(12550)).toBe("125.5");
  });
});
