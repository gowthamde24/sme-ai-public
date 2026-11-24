import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseAvailable, parseClaimed, parseOwnList, reasonOf } from "@/lib/api/numbers";

import { fixtureNumbers } from "./source";
import { displayNumber, forwardCode, isNumber, isPrefix } from "./types";

describe("a number is always +91 XXXXX XXXXX", () => {
  it("draws the digits, and leaves anything else alone", () => {
    expect(displayNumber("+919876543210")).toBe("+91 98765 43210");
    expect(displayNumber("98765")).toBe("98765");
    expect(isNumber("+919876543210")).toBe(true);
    expect(isNumber("+9198765")).toBe(false);
  });
  it("accepts 0 to 6 digits as 'starts with'", () => {
    expect(["", "9", "984920"].every(isPrefix)).toBe(true);
    expect(["1234567", "98a", " 9"].some(isPrefix)).toBe(false);
  });
});

describe("the API answers (contract note, 28 Nov)", () => {
  it("reads the list, never a price, and draws the number itself (not the server's display)", () => {
    const r = parseAvailable({ numbers: [{ number: "+919876543210", display: "whatever", type: "mobile", price: 999 }], page: 1, more: true });
    expect(r).toEqual({ numbers: [{ number: "+919876543210", display: "+91 98765 43210", type: "mobile" }], page: 1, more: true });
    expect(JSON.stringify(r)).not.toMatch(/price|999/);
  });
  it("leaves out a row that is not the contract's shape", () => {
    expect(parseAvailable({ numbers: [{ number: "12", type: "mobile" }, { number: "+919876543211", type: "landline" }], page: 1, more: false }).numbers).toHaveLength(1);
  });
  it("reads the claim (201 has no type: the picked type is kept) and the workspace numbers", () => {
    expect(parseClaimed({ number: "+919876543210", display: "x", state: "getting_ready" }, "mobile")).toMatchObject({ display: "+91 98765 43210", type: "mobile", state: "getting_ready" });
    expect(parseClaimed({ number: "+914012345678", display: "x", type: "landline", state: "getting_ready" }, "mobile").type).toBe("landline"); // the server's own type wins
    expect(parseOwnList({ numbers: [{ number: "+919876543210", type: "mobile", state: "calls_off", label: null }] })[0].state).toBe("calls_off");
  });
  it("reads the reason of a 409 numbers_unavailable from `reason` or the first field, and drops a word outside the contract", () => {
    expect(reasonOf(new ApiRequestError(409, "numbers_unavailable", "x", "not_on_plan"))).toBe("not_on_plan");
    expect(reasonOf(new ApiRequestError(409, "numbers_unavailable", "x", undefined, undefined, undefined, { fields: ["paused"] }))).toBe("paused");
    expect(reasonOf(new ApiRequestError(409, "numbers_unavailable", "x", "something_new"))).toBeUndefined();
  });
});

describe("the test screen's made-up numbers", () => {
  it("lists 20 a page, mobile ones start with 6 to 9, and the digits asked for come first", () => {
    const a = fixtureNumbers("mobile", "", 1);
    expect(a.numbers).toHaveLength(20);
    expect(a.more).toBe(true);
    expect(a.numbers.every((n) => /^\+91[6-9]\d{9}$/.test(n.number))).toBe(true);
    expect(fixtureNumbers("mobile", "98", 1).numbers.every((n) => n.number.startsWith("+9198"))).toBe(true);
    expect(fixtureNumbers("mobile", "", 3).more).toBe(false);
  });
  it("says nothing matches for digits no number starts with", () => {
    expect(fixtureNumbers("mobile", "123", 1).numbers).toEqual([]);
    expect(fixtureNumbers("mobile", "000", 1).numbers).toEqual([]);
  });
});

describe("the forwarding codes", () => {
  it("gives the standard 'when I do not answer' code for Airtel, Vi and BSNL, and none for Jio (the screen says where to look)", () => {
    expect(forwardCode("airtel", "+919876543210")).toEqual({ on: "**61*+919876543210#", off: "##61#" });
    expect(forwardCode("jio", "+919876543210")).toBeNull();
  });
});
