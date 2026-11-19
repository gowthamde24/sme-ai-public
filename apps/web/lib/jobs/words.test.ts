import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";

import { DNC_HOWS, DNC_REASONS } from "./dnc";
import { APPROVAL_KINDS, DAY_CODES, EXCLUDED_CODES, PLAN_BASES, PLAN_BLOCKERS, WHEN_STARTS } from "./plan";
import { RESULT_CODES } from "./result";
import { PLAN_GATES } from "./types";
import { JOBS_CODE_WORDS } from "@/app/app/tenants/[tenantId]/jobs/refusal";

const dict = app as Record<string, { en: string; te: string; hi: string; kn: string }>;
const has = (key: string): boolean => key in dict && Boolean(dict[key].en && dict[key].te && dict[key].hi && dict[key].kn);

/** Every closed code of the Jobs contract has its sentence in all four languages (a code with no words would draw a raw key on a person's screen). */
describe("the contract's closed codes all have words (en, te, hi, kn)", () => {
  it("result codes, plan gates, who-basis codes, blockers, do-not-call reasons and the error codes", () => {
    const missing = [
      ...RESULT_CODES.map((c) => `jobs.res.${c}`),
      "jobs.res.other",
      ...PLAN_GATES.map((c) => `jobs.gate.${c}`),
      ...PLAN_BASES.map((c) => `jobs.new.who.${c}`),
      ...PLAN_BLOCKERS.filter((c) => c !== "unclear_who").map((c) => `jobs.new.blocker.${c}`),
      ...DNC_REASONS.map((c) => `jobs.dnc.reason.${c}`),
      ...DNC_HOWS.map((c) => `jobs.dnc.history.${c}`),
      ...EXCLUDED_CODES.map((c) => `jobs.new.excl.${c}`),
      ...APPROVAL_KINDS.map((c) => `jobs.new.waiting.${c}`),
      ...WHEN_STARTS.map((c) => `jobs.new.when.start.${c}`),
      ...DAY_CODES.map((c) => `jobs.new.dayshort.${c}`),
      ...Object.values(JOBS_CODE_WORDS),
    ].filter((k) => !has(k));
    expect(missing).toEqual([]);
  });
  it("a sentence that has a singular says it in all four languages", () => {
    const ones = Object.keys(dict).filter((k) => k.startsWith("jobs.res.") && k.endsWith(".one"));
    expect(ones.length).toBeGreaterThan(0);
    for (const k of ones) expect(has(k), k).toBe(true);
  });
});
