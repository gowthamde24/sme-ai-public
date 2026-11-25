import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { KYC_REASONS, DOC_TYPES } from "@/lib/api/business-kyc";
import { KIND_KEYS, TELL_KINDS, TELL_MODES } from "@/lib/jobs/tell";
import { JOB_KINDS } from "@/lib/jobs/types";

/**
 * String completeness of "Tell your assistant what to do" and "Get a phone number / Verify your business" (TELL_SCREENS, KYC_PER_CLIENT): every key these screens name in their source is in the store in all four languages, as a DRAFT in Telugu, Hindi and
 * Kannada (nothing of ours is reviewed yet), in the language's own script, with the same {placeholders} as the English; every family a screen builds a key from (`jobs.tell.who.${kind}`, `pick.kyc.err.${reason}`) has all its members.
 */
const dict = app as Record<string, { en: string; te: string; hi: string; kn: string; status: Record<string, string> }>;
const FILES = [
  "components/v2/app/jobs/tell/TellAssistant.tsx",
  "components/v2/app/jobs/JobsList.tsx",
  "components/v2/app/phone/PhoneBuy.tsx",
  "components/v2/app/phone/VerifyBusiness.tsx",
  "components/v2/app/phone/steps.tsx",
  "app/app/tenants/[tenantId]/phone-number/page.tsx",
];
const MINE = /^(jobs\.tell\.|pick\.buy\.|pick\.kyc\.|pick\.why\.kyc_required$)/;
const source = FILES.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
const literal = /["'`]((?:jobs\.tell|pick\.buy|pick\.kyc|pick\.why\.kyc_required)[\w.]*[\w])["'`]/g;
const named = new Set([...source.matchAll(literal)].map((m) => m[1]).filter((k) => k in dict || !/\.$/.test(k)));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const mine = Object.keys(dict).filter((k) => MINE.test(k));

describe("the strings of Tell your assistant and the phone buy and verify flows", () => {
  it("finds the keys it polices", () => {
    expect(named.size).toBeGreaterThan(40);
    expect(mine.length).toBeGreaterThan(100);
  });
  it("every key the screens name is in the store", () => {
    expect([...named].filter((k) => MINE.test(k) && !(k in dict))).toEqual([]);
  });
  it("every family has all its members", () => {
    const missing: string[] = [];
    for (const k of TELL_KINDS) for (const part of ["who", "does", "asks"]) if (!(`jobs.tell.${part}.${k}` in dict)) missing.push(`jobs.tell.${part}.${k}`);
    for (const m of TELL_MODES) for (const part of ["t", "d"]) if (!(`jobs.tell.mode.${m}.${part}` in dict)) missing.push(`jobs.tell.mode.${m}.${part}`);
    for (const r of KYC_REASONS) if (!(`pick.kyc.err.${r}` in dict)) missing.push(`pick.kyc.err.${r}`);
    for (const d of DOC_TYPES) for (const part of ["", ".file"]) if (!(`pick.kyc.doc.${d}${part}` in dict)) missing.push(`pick.kyc.doc.${d}${part}`);
    for (const c of ["waiting", "checking", "done", "stuck"]) if (!(`pick.kyc.chip.${c}` in dict)) missing.push(`pick.kyc.chip.${c}`);
    for (const t of ["individual", "business"]) if (!(`pick.buy.type.${t}` in dict)) missing.push(`pick.buy.type.${t}`);
    // the labels and choices of the draft's fields come from the Jobs words that already exist
    for (const kind of JOB_KINDS) for (const key of KIND_KEYS[kind]) if (!(`jobs.f.${key}` in dict)) missing.push(`jobs.f.${key}`);
    expect(missing).toEqual([]);
  });
  it("four languages, no empty string, the same placeholders, every non-English string a DRAFT", () => {
    for (const k of mine) {
      const e = dict[k];
      for (const l of ["en", "te", "hi", "kn"] as const) expect(e[l].trim().length, `${l}:${k}`).toBeGreaterThan(0);
      for (const l of ["te", "hi", "kn"] as const) {
        expect(placeholders(e[l]), `${l}:${k}`).toEqual(placeholders(e.en));
        expect(e.status[l], `${l}:${k}`).toBe("draft");
      }
    }
  });
  it("Telugu, Hindi and Kannada are in their own script", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    for (const k of mine) for (const l of ["te", "hi", "kn"] as const) expect(script[l].test(dict[k][l]), `${l}:${k}`).toBe(true);
  });
  it("the rotating example has a Telugu one among its three (English, English, Telugu)", () => {
    expect(/[ఀ-౿]/.test(dict["jobs.tell.ph.3"].en)).toBe(true);
    expect(/[ఀ-౿]/.test(dict["jobs.tell.ph.1"].en)).toBe(false);
  });
  it("no price anywhere on these screens, and no bookish Hindi or Kannada for 'document' and 'certificate'", () => {
    for (const k of mine) for (const l of ["en", "te", "hi", "kn"] as const) expect(dict[k][l], `${l}:${k}`).not.toMatch(/₹|Rs\.?\s?\d|per month/i);
    for (const k of mine) {
      expect(dict[k].hi, k).not.toMatch(/दस्तावेज़|प्रमाणपत्र/);
      expect(dict[k].kn, k).not.toMatch(/ದಾಖಲೆ|ಪ್ರಮಾಣಪತ್ರ/);
    }
  });
});
