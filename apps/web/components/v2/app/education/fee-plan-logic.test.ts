import { describe, expect, it } from "vitest";

import { academicYearOf, isAcademicYear, readLate, readLines } from "./fee-plan-logic";

describe("the academic year", () => {
  it.each([["2026-10-14", 6, "2026-27"], ["2026-05-31", 6, "2025-26"], ["2026-06-01", 6, "2026-27"], ["2027-03-31", 6, "2026-27"], ["2026-01-05", 1, "2026-27"], ["2099-12-31", 4, "2099-00"]])("%s with a year that starts in month %i is %s", (day, month, want) => {
    expect(academicYearOf(day, month)).toBe(want);
  });
  it("accepts only a year whose second half follows the first", () => {
    expect(isAcademicYear("2026-27")).toBe(true);
    expect(isAcademicYear("2099-00")).toBe(true);
    for (const bad of ["2026-28", "2026", "26-27", "2026-2", "1999-00", ""]) expect(isAcademicYear(bad)).toBe(false);
  });
});

describe("reading the typed instalments", () => {
  const row = (over = {}) => ({ head: "tuition" as const, no: "1", due: "2026-06-15", amount: "25,000", ...over });
  it("turns rupees into paise and adds them up", () => {
    expect(readLines([row(), row({ no: "2", due: "2026-10-15", amount: "15000.50" }), row({ head: "transport", amount: "7000" })])).toEqual({
      ok: true, total: 2500000 + 1500050 + 700000,
      lines: [{ head: "tuition", instalment_no: 1, due_date: "2026-06-15", amount_paise: 2500000 }, { head: "tuition", instalment_no: 2, due_date: "2026-10-15", amount_paise: 1500050 }, { head: "transport", instalment_no: 1, due_date: "2026-06-15", amount_paise: 700000 }],
    });
  });
  it.each([
    ["no rows", [], "none", 0], ["a number that is not a whole number", [row({ no: "1.5" })], "no", 1], ["instalment 0", [row({ no: "0" })], "no", 1], ["instalment 61", [row({ no: "61" })], "no", 1],
    ["an impossible day", [row(), row({ no: "2", due: "2026-02-30" })], "due", 2], ["no day", [row({ due: "" })], "due", 1], ["no amount", [row({ amount: "" })], "amount", 1], ["a zero amount", [row({ amount: "0" })], "amount", 1],
    ["an amount above the limit", [row({ amount: "1000001" })], "amount", 1], ["a negative amount", [row({ amount: "-5" })], "amount", 1], ["the same head and number twice", [row(), row({ due: "2026-07-01" })], "twice", 2],
  ])("%s is refused with its reason and row", (_n, drafts, reason, rowNo) => {
    expect(readLines(drafts as never)).toEqual({ ok: false, reason, row: rowNo });
  });
  it("more than 100 rows is refused", () => {
    expect(readLines(Array.from({ length: 101 }, (_, i) => row({ no: String((i % 60) + 1) })))).toEqual({ ok: false, reason: "many", row: 0 });
  });
});

describe("the late-fee rule", () => {
  it("no rule is no amount", () => {
    expect(readLate({ kind: "none", amount: "500", grace: "9", cap: "100" })).toEqual({ ok: true, kind: "none", paise: null, grace: 0, cap: null });
  });
  it("a fixed fee has an amount and a grace, never a cap", () => {
    expect(readLate({ kind: "fixed", amount: "200", grace: "5", cap: "999" })).toEqual({ ok: true, kind: "fixed", paise: 20000, grace: 5, cap: null });
  });
  it("a per-day fee may have a cap", () => {
    expect(readLate({ kind: "per_day", amount: "50", grace: "", cap: "1000" })).toEqual({ ok: true, kind: "per_day", paise: 5000, grace: 0, cap: 100000 });
    expect(readLate({ kind: "per_day", amount: "50", grace: "3", cap: "" })).toEqual({ ok: true, kind: "per_day", paise: 5000, grace: 3, cap: null });
  });
  it.each([["amount", { kind: "fixed" as const, amount: "", grace: "0", cap: "" }], ["grace", { kind: "fixed" as const, amount: "5", grace: "61", cap: "" }], ["grace", { kind: "fixed" as const, amount: "5", grace: "1.5", cap: "" }], ["cap", { kind: "per_day" as const, amount: "5", grace: "0", cap: "0" }]])("a bad %s is refused", (reason, d) => {
    expect(readLate(d)).toEqual({ ok: false, reason });
  });
});
