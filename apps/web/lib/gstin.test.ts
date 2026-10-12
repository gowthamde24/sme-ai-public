import { describe, expect, it } from "vitest";

import { checkCharacter, gstinProblem, isValidGstin, normaliseGstin, stateOfGstin } from "./gstin";

// the three published example numbers the API's rule was checked against (services/ai-api/app/gstin.py)
const GOOD = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "24AAACC1206D1ZM"];

describe("a GSTIN, checked for form", () => {
  it.each(GOOD)("%s is well formed, and its check character is the one the rule computes", (g) => {
    expect(isValidGstin(g)).toBe(true);
    expect(checkCharacter(g.slice(0, 14))).toBe(g[14]);
    expect(gstinProblem(g)).toBeNull();
  });
  it("forgives spaces, dashes and small letters", () => {
    expect(normaliseGstin(" 27aapfu-0939 f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(gstinProblem(" 27aapfu-0939 f1zv ")).toBeNull();
  });
  it("nothing typed is 'none', which is allowed", () => {
    expect(gstinProblem("")).toBeNull();
    expect(gstinProblem("  - ")).toBeNull();
  });
  it("says what is wrong, in the order a person fixes it: length, then shape, then the check character", () => {
    expect(gstinProblem("27AAPFU0939F1Z")).toBe("length");
    expect(gstinProblem("27AAPFU0939F1ZVX")).toBe("length");
    expect(gstinProblem("99999FU0939F1ZV")).toBe("shape"); // the PAN must start with five letters
    expect(gstinProblem("40AAPFU0939F1ZV")).toBe("shape"); // no state 40
    expect(gstinProblem("27AAPFU0939F1AV")).toBe("shape"); // the 14th character must be Z
    expect(gstinProblem("27AAPFU0939F1ZW")).toBe("check");
  });
  it("one wrong character in a good number is always found (shape or check)", () => {
    const g = GOOD[0];
    const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let found = 0;
    for (let i = 0; i < 15; i += 1) for (const ch of A) if (ch !== g[i] && gstinProblem(g.slice(0, i) + ch + g.slice(i + 1)) === null) found += 1;
    expect(found).toBe(0);
  });
  it("names the state from the first two digits", () => {
    expect(stateOfGstin("27AAPFU0939F1ZV")).toBe("Maharashtra");
    expect(stateOfGstin("29AAGCB7383J1Z4")).toBe("Karnataka");
    expect(stateOfGstin("36AAAAA0000A1Z5")).toBe("Telangana");
    expect(stateOfGstin("00XXXX")).toBeNull();
  });
});
