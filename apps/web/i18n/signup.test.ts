import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import signup from "@/i18n/strings/signup.json";
import { LANGS } from "@/i18n/lang";
import { signupDict, signupT } from "@/i18n/signup";
import { TRANSLATED_LANGS, dictFor } from "@/i18n/strings";
import { FORBIDDEN_CLAIMS as FORBIDDEN } from "@/i18n/strings/forbidden";

type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string>; humanOnly?: boolean };
const data = signup as Record<string, Entry>;
const keys = Object.keys(data);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const HUMAN_ONLY = ["signup.err.terms_required", "signup.terms"];

describe("the sign-up string store (Job AC, C5)", () => {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, dictFor(signup as never, l) as Record<string, string>]));
  it("has the same keys in four languages, no empty string, the same {placeholders}", () => {
    for (const lang of LANGS) {
      expect(Object.keys(dicts[lang]).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dicts[lang][k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(placeholders(dicts[lang][k]), `${lang}:${k}`).toEqual(placeholders(dicts.en[k]));
      }
    }
  });
  it("every non-English string is a DRAFT", () => {
    for (const k of keys) for (const l of TRANSLATED_LANGS) expect(data[k].status[l], `${k}:${l}`).toBe("draft");
  });
  it("uses each language's own script, except the strings that stay English until a person reviews them (the terms)", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    for (const l of TRANSLATED_LANGS) expect(keys.filter((k) => !data[k].humanOnly && !script[l].test(dicts[l][k])), l).toEqual([]);
    expect(keys.filter((k) => data[k].humanOnly).sort()).toEqual(HUMAN_ONLY);
    for (const k of HUMAN_ONLY) for (const l of TRANSLATED_LANGS) expect(dicts[l][k].replaceAll("⁠", ""), `${k}:${l}`).toBe(dicts.en[k]);
  });
  it("makes no claim we cannot prove, never hard-codes the brand name, and does not promise when sign-up opens", () => {
    for (const l of LANGS)
      for (const k of keys) {
        for (const [re, label] of FORBIDDEN) expect(re.test(dicts[l][k]), `${l}:${k} contains ${label}`).toBe(false);
        expect(dicts[l][k]).not.toMatch(/sme-?ai/i);
      }
    // the four refusals the action can give (SIGNUP_ERRORS of lib/api/signup) each have a sentence; "email taken" does not exist (no account enumeration)
    for (const code of ["weak_password", "terms_required", "too_many_signups", "invalid"]) expect(dicts.en[`signup.err.${code}`], code).toBeTruthy();
    expect(keys.filter((k) => /taken|exists|already has an account/i.test(dicts.en[k]))).toEqual([]);
    expect(keys).not.toContain("signup.notavailable"); // the screens are wired to the real actions
  });
  it("resolves one language at a time", () => {
    expect(signupT("en")("signup.title")).toBe("Create your account");
    expect(signupDict("hi")["signup.submit"]).toBe("अकाउंट बनाएँ");
  });
  it("is server only: no client component imports it", () => {
    const WEB = path.resolve(import.meta.dirname, "..");
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const clients = [...walk(path.join(WEB, "components")), ...walk(path.join(WEB, "app"))].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/i18n\/signup"|@\/i18n\/strings\/signup\.json/);
  });
});
