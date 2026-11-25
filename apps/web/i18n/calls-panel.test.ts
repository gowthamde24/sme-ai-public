import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";

/**
 * The calls panel's words (`cpn.`: Before you start calling, Hear it yourself, Calls at once, How calls are billed; owner, 29 Nov 2026): every one is in the string store in English, Telugu, Hindi and Kannada with the same {placeholders}, the other three in their own script and
 * marked DRAFT (a person who reads the language reviews them), no screen of the panel writes a word of its own, and every key a screen names exists.
 */
type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string> };
const dict = app as unknown as Record<string, Entry>;
const keys = Object.keys(dict).filter((k) => k.startsWith("cpn."));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const SCRIPT = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
const OTHER = { te: [SCRIPT.hi, SCRIPT.kn], hi: [SCRIPT.te, SCRIPT.kn], kn: [SCRIPT.te, SCRIPT.hi] } as const;
const WEB = path.resolve(__dirname, "..");
const PANEL = path.join(WEB, "components/v2/app/calls/panel");
const source = (dir: string) => fs.readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f)).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as const);

describe("the calls panel strings", () => {
  it("has the strings (rules, hear, lines, billing)", () => {
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const k of ["cpn.rules.title", "cpn.rules.read", "cpn.hear.title", "cpn.hear.start", "cpn.once.title", "cpn.once.count", "cpn.once.note", "cpn.once.add", "cpn.bill.title", "cpn.bill.draft"]) expect(keys, k).toContain(k);
    for (const n of [1, 2, 3, 4, 5]) expect(keys).toEqual(expect.arrayContaining([`cpn.rule.${n}.b`, `cpn.rule.${n}.t`]));
    for (const n of [1, 2, 3, 4]) expect(keys).toEqual(expect.arrayContaining([`cpn.bill.${n}.b`, `cpn.bill.${n}.t`]));
  });
  it("every key has all four languages, the same {placeholders}, and the three others in their own script (no other Indian script mixed in)", () => {
    for (const k of keys) {
      const e = dict[k];
      for (const lang of ["en", "te", "hi", "kn"] as const) {
        expect(e[lang].trim().length, `${k}:${lang}`).toBeGreaterThan(0);
        expect(placeholders(e[lang]), `${k}:${lang}`).toEqual(placeholders(e.en));
      }
      for (const lang of ["te", "hi", "kn"] as const) {
        expect(e[lang], `${k}:${lang} script`).toMatch(SCRIPT[lang]);
        for (const other of OTHER[lang]) expect(e[lang], `${k}:${lang} mixes scripts`).not.toMatch(other);
      }
    }
  });
  it("Telugu, Hindi and Kannada are DRAFTS until a person who reads the language reviews them", () => {
    for (const k of keys) expect(dict[k].status, k).toEqual({ te: "draft", hi: "draft", kn: "draft" });
  });
  it("the rules say what the call gate does (9 am to 9 pm) in every language, and no string writes a price", () => {
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      expect(dict["cpn.rule.2.t"][lang], lang).toMatch(/9/);
      for (const k of keys) expect(dict[k][lang], `${k}:${lang}`).not.toMatch(/₹|\bRs\.?\s?\d|रु\s?\d/);
    }
  });
  it("the machine-draft wording follows the owner's Telugu rule: అనుమతి for consent, English business words, no bookish forms", () => {
    expect(dict["cpn.rule.1.b"].te).toContain("అనుమతి");
    for (const k of keys) expect(dict[k].te, k).not.toMatch(/సందేశం|దయచేసి|నిర్ణయం/);
  });
  it("the English is plain: no fill-in-the-blank brackets, no ids, no jargon", () => {
    for (const k of keys) expect(dict[k].en, k).not.toMatch(/\[[^\]]*\]|\bAPI\b|\bDLT\b|\bDND\b|\bVoiceLink\b|\bPlivo\b/);
  });
});

describe("the screens of the panel", () => {
  const files = source(PANEL);
  it("every key a screen names exists in the store, and every key of the store is named by a screen (family keys by their prefix)", () => {
    const named = new Set<string>();
    const families: string[] = [];
    for (const [, src] of files) {
      for (const m of src.matchAll(/["'`](cpn\.[a-z0-9.]+)["'`]/g)) if (!m[1].endsWith(".")) named.add(m[1]); // (a name ending in a dot is a prefix written in a comment)
      for (const m of src.matchAll(/`(cpn\.[a-z0-9.]+\.)\$\{/g)) families.push(m[1]);
    }
    // the pages name the prefixes they ask the store for
    for (const f of ["app/app/tenants/[tenantId]/calls/calls-v6-data.tsx", "app/app/tenants/[tenantId]/lead-sources/page.tsx", "app/app/tenants/[tenantId]/phone-number/page.tsx", "app/app/tenants/[tenantId]/billing/page.tsx"]) {
      const src = fs.readFileSync(path.join(WEB, f), "utf8");
      expect(/"cpn\.[a-z.]+"/.test(src), f).toBe(true);
    }
    expect([...named].filter((k) => !(k in dict) && !families.some((p) => k.startsWith(p)))).toEqual([]);
    const unused = keys.filter((k) => !named.has(k) && !families.some((p) => k.startsWith(p)));
    // the sub-lines of the families (`cpn.rule.${n}.b`) are reached through the template literal
    expect(unused).toEqual([]);
  });
  it("no screen of the panel has a word of its own: all text goes through the store (no English in the JSX)", () => {
    for (const [name, src] of files) {
      // text between a tag's > and the next < that holds letters and is not an expression: `>Word<`
      const literal = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'-]{2,})\s*</g)].map((m) => m[1]).filter((w) => !/^(typeof|string|void)$/.test(w));
      expect(literal, name).toEqual([]);
      expect([...src.matchAll(/(?:aria-label|title|placeholder|alt)="([A-Za-z][^"]*)"/g)].map((m) => m[1]), name).toEqual([]);
    }
  });
  it("the panel draws no sentence form and no boxed list row (only the Hear it yourself card and the line tiles are boxed: things you start or read as a unit)", () => {
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/<(Sentence|LinkSentence)\b/);
      expect(src, name).not.toMatch(/stock|unsplash|<img\b|<Image\b/i);
    }
  });
});
