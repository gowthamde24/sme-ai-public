import { describe, expect, it } from "vitest";

import { parseSummary } from "@/lib/api/ledger";
import { SUMMARY_JSON } from "@/lib/api/ledger-fixtures";

import { share, today, totals } from "./ledger-logic";
import { readProofAnswer } from "../deliveries/upload-proof";

describe("totals over the customers", () => {
  it("adds what the ledger says; nothing is worked out", () => {
    const t = totals(parseSummary(SUMMARY_JSON).items);
    expect(t.outstanding).toBe(13000000 + 4500000);
    expect(t.overdue).toBe(5000000);
    expect(t.over).toBe(1);
    expect(t.ageing).toEqual({ d0_30: 8000000 + 4500000, d31_60: 5000000, d61_90: 0, d90_plus: 0 });
  });
  it("shares are whole numbers between 0 and 100, and 0 of nothing", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(5, 2)).toBe(100);
    expect(share(0, 0)).toBe(0);
    expect(share(-1, 5)).toBe(0);
  });
  it("today is the India day", () => {
    expect(today(Date.parse("2026-10-14T20:00:00Z"))).toBe("2026-10-15");
  });
});

describe("the proof upload's answer", () => {
  it("reads ok, a closed code, and anything else as a bad answer", () => {
    expect(readProofAnswer(200, '{"ok":true}')).toEqual({ ok: true });
    expect(readProofAnswer(409, '{"ok":false,"code":"trip_state"}')).toEqual({ ok: false, code: "trip_state" });
    expect(readProofAnswer(401, "<html>")).toEqual({ ok: false, code: "unauthorized" });
    expect(readProofAnswer(200, "<html>")).toEqual({ ok: false, code: "bad_answer" });
    expect(readProofAnswer(500, '{"ok":false,"code":"Not A Code!"}')).toEqual({ ok: false, code: "bad_answer" });
    expect(readProofAnswer(200, "null")).toEqual({ ok: false, code: "bad_answer" });
    expect(readProofAnswer(200, '{"ok":"yes"}')).toEqual({ ok: false, code: "bad_answer" });
  });
});
