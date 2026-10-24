import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LANGS } from "@/i18n/lang";
import { appDict } from "@/i18n/app";

/**
 * Job DF: on staging, "Add from the ledger" in a school answered "0 people added. Line 1: could not be added", because the database skipped the family for `no_contact` (no phone number on file, or do-not-contact)
 * and the screen had words for three of the four reasons the ledger and the list can give. Every closed reason the audience functions write must have its own words, in every language.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, "../../../../../../supabase/migrations");

function reasonsInSql(): string[] {
  const found = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => /cp_campaigns|cr_fees|cq_|cs_|ct_|cu_/.test(n))) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/jsonb_build_object\('row', [a-z_]+, 'reason', '([a-z_]+)'\)/g)) found.add(m[1]);
    for (const m of sql.matchAll(/v_reason := '([a-z_]+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe("the words for why a person could not be added to a campaign", () => {
  it("the audience functions' closed reasons are found (so this test cannot pass by finding nothing)", () => {
    expect(reasonsInSql()).toEqual(expect.arrayContaining(["no_contact", "no_lead", "duplicate", "amount_over_cap", "contact_not_found"]));
  });
  it.each(LANGS)("%s: every reason has its own words, and no_contact says what is missing", (lang) => {
    const dict = appDict(lang) as Record<string, string>;
    for (const r of reasonsInSql()) expect(dict[`camp.aud.skip.${r}`], `${lang}: camp.aud.skip.${r}`).toBeTruthy();
    expect(dict["camp.aud.skip.no_contact"]).not.toBe(dict["camp.aud.skip.other"]);
  });
});
