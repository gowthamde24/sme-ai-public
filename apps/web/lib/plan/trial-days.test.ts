import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fill } from "@/i18n/fill";
import { fillLegal } from "@/lib/legal/documents";

import { DRAFT_PLANS } from "./catalogue";
import { TRIAL_DAYS, withTrialDays } from "./trial-days";

const WEB = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(WEB, ...p), "utf8");

describe("the length of the free trial is read from the plans data (job DO)", () => {
  it("is the plans catalogue's number, and the one in the packages' own file", () => {
    expect(TRIAL_DAYS).toBe(DRAFT_PLANS.trial.days);
    expect(TRIAL_DAYS).toBe(JSON.parse(read("..", "..", "packages", "plans", "plans.json")).trial.days);
  });
  it("is what {trial_days} says in fill(), in the dictionaries' words and in the legal texts", () => {
    expect(fill("{trial_days}-day trial")).toBe(`${TRIAL_DAYS}-day trial`);
    expect(withTrialDays("A {trial_days} days trial, {trial_days}")).toBe(`A ${TRIAL_DAYS} days trial, ${TRIAL_DAYS}`);
    expect(fillLegal("{trial_days}-day free trial")).toBe(`${TRIAL_DAYS}-day free trial`);
  });
  it("no public string, sign-in word or legal text writes the trial's length as a number", () => {
    const files = ["site.json", "login.json", "legal.json"].map((f) => read("i18n", "strings", f)).concat(read("lib", "legal", "terms-text.ts"), read("lib", "legal", "privacy-text.ts"));
    for (const text of files) expect(text).not.toMatch(/\b(14|30)[- ]days?\b[^"\n]{0,40}trial|trial[^"\n]{0,60}\b(14|30)[- ]days?\b|\b(14|30)-day (free )?trial/i);
  });
});
