import { describe, expect, it } from "vitest";

import { exampleText, fieldsFor, fieldsUsed, insertField, kindsFor, parseList, readSteps, splitLine, stepPhrase } from "./campaign-logic";

describe("which reminders a business may start", () => {
  it("each kind needs its own module", () => {
    expect(kindsFor(["campaigns", "dues", "deliveries"])).toEqual(["payment_due", "delivery_update"]);
    expect(kindsFor(["campaigns", "dues", "fees", "programmes"])).toEqual(["payment_due", "fee_due", "event", "exam", "holiday"]);
    expect(kindsFor(["campaigns"])).toEqual([]);
    expect(kindsFor([])).toEqual([]);
  });
  it("only a money reminder may carry an amount", () => {
    expect(fieldsFor("payment_due")).toContain("amount");
    expect(fieldsFor("fee_due")).toContain("amount");
    for (const k of ["delivery_update", "event", "exam", "holiday"] as const) expect(fieldsFor(k)).not.toContain("amount");
  });
});

describe("the text", () => {
  it("names the fields it uses, once each, and the ones that are not fields", () => {
    expect(fieldsUsed("Hello {{name}}, {{ amount }} for {{reference}} {{name}} {{discount}} {{}}")).toEqual({ used: ["name", "amount", "reference"], bad: ["discount", ""] });
    expect(fieldsUsed("no fields")).toEqual({ used: [], bad: [] });
  });
  it("puts a field at the cursor with a space where one is missing and none before punctuation", () => {
    expect(insertField("Hello", "name", null)).toEqual({ text: "Hello {{name}}", cursor: 14 });
    expect(insertField("Hello, you owe .", "amount", 14)).toEqual({ text: "Hello, you owe {{amount}} .", cursor: 25 });
    expect(insertField("", "business", 0)).toEqual({ text: "{{business}}", cursor: 12 });
    expect(insertField("ab", "name", 99).text).toBe("ab {{name}}");
  });
  it("shows an example with invented values", () => {
    expect(exampleText("Hi {{name}}, {{amount}} on {{due_date}} for {{reference}} - {{business}}", { name: "A", amount: "₹1", due_date: "D", reference: "R", business: "B" })).toBe("Hi A, ₹1 on D for R - B");
  });
});

describe("the steps", () => {
  const ok = (offset: string, time = "10:00") => ({ offset, time });
  it("reads days from the date and a time of day", () => {
    expect(readSteps([ok("-3"), ok("0"), ok("7", "11:30")])).toEqual({ ok: true, steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }, { offset_days: 7, time: "11:30" }] });
    expect(readSteps([ok("−2")])).toEqual({ ok: true, steps: [{ offset_days: -2, time: "10:00" }] });
  });
  it.each([[[], "none"], [[ok("1"), ok("2"), ok("3"), ok("4"), ok("5"), ok("6")], "none"], [[ok("x")], "offset"], [[ok("181")], "offset"], [[ok("-61")], "offset"], [[ok("1.5")], "offset"], [[ok("0", "25:00")], "time"], [[ok("0", "9:00")], "time"], [[ok("2"), ok("1")], "order"], [[ok("1"), ok("1")], "order"]])("%j is refused (%s)", (drafts, reason) => {
    expect(readSteps(drafts as never)).toEqual({ ok: false, reason });
  });
  it("two steps on one day are fine when the times rise", () => {
    expect(readSteps([ok("0", "09:00"), ok("0", "17:00")]).ok).toBe(true);
    expect(readSteps([ok("0", "17:00"), ok("0", "09:00")]).ok).toBe(false);
  });
  it("says a step in words", () => {
    const w = { before: (n: number) => `${n} before`, on: () => "on", after: (n: number) => `${n} after` };
    expect([-3, 0, 7].map((n) => stepPhrase(n, w))).toEqual(["3 before", "on", "7 after"]);
  });
});

describe("reading a list of people", () => {
  const PHONE = "+91 90000 20001";
  it("takes a number or a contact id, a date, an amount in rupees and a reference; a heading is skipped", () => {
    const r = parseList(`phone,date,amount,reference\n${PHONE},2026-10-20,"1,25,000.50",INV-1001\n22222222-2222-4222-8222-2222222222AA,20/10/2026,500\n`, true);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ phone: PHONE, due_date: "2026-10-20", amount_paise: 12500050, reference: "INV-1001" }, { contact_id: "22222222-2222-4222-8222-2222222222aa", due_date: "2026-10-20", amount_paise: 50000 }]);
  });
  it("a spreadsheet pasted as text (tabs) reads the same", () => {
    expect(parseList(`${PHONE}\t2026-10-20\t900\tFEE-1`, true).rows).toEqual([{ phone: PHONE, due_date: "2026-10-20", amount_paise: 90000, reference: "FEE-1" }]);
  });
  it("a reminder without money takes no amount", () => {
    expect(parseList(`${PHONE},2026-10-20`, false).rows).toEqual([{ phone: PHONE, due_date: "2026-10-20" }]);
    expect(parseList(`${PHONE},2026-10-20,500`, false).errors).toEqual([{ line: 1, reason: "amount" }]);
  });
  it.each([
    ["a line with one column", "9000020001", "columns"], ["a name where a number goes", "Ravi,2026-10-20,500", "who"], ["a date that does not exist", `${PHONE},2026-02-30,500`, "date"], ["a date in words", `${PHONE},tomorrow,500`, "date"],
    ["no amount", `${PHONE},2026-10-20`, "amount"], ["an amount of zero", `${PHONE},2026-10-20,0`, "amount"], ["an amount above ten lakh", `${PHONE},2026-10-20,1000001`, "amount"], ["a reference with symbols", `${PHONE},2026-10-20,500,<b>`, "reference"],
  ])("%s is reported by its line and kept out", (_n, line, reason) => {
    const r = parseList(`${PHONE},2026-10-19,100\n${line}`, true);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 2, reason }]);
    expect(r.total).toBe(2);
  });
  it("blank lines and a byte order mark do not count", () => {
    expect(parseList(`﻿${PHONE},2026-10-20,100\n\n\n`, true).total).toBe(1);
  });
  it("splits at tabs and commas but not inside quotes", () => {
    expect(splitLine('a,"b,c",d\te')).toEqual(["a", "b,c", "d", "e"]);
  });
});
