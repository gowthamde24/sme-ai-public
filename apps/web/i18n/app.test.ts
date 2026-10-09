import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { appDict, appT, frameLabels } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";
import { TRANSLATED_LANGS, dictFor } from "@/i18n/strings";
import { FORBIDDEN_CLAIMS as FORBIDDEN } from "@/i18n/strings/forbidden";
import { FOOT, NAV } from "@/components/v2/app/nav";

type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string>; humanOnly?: boolean };
const data = app as Record<string, Entry>;
const keys = Object.keys(data);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const HUMAN_ONLY = ["today.fact.amount", "today.hint.nothingSent", "today.kind.order", "today.stat.held", "today.stat.heldHint"]; // money held, amounts and what a button sends or does not: English until a person reviews them

describe("the frame's string store (language track L0)", () => {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, dictFor(app as never, l) as Record<string, string>]));
  it("has the same keys in four languages, no empty string, the same {placeholders}", () => {
    for (const lang of LANGS) {
      expect(Object.keys(dicts[lang]).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dicts[lang][k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(placeholders(dicts[lang][k]), `${lang}:${k}`).toEqual(placeholders(dicts.en[k]));
      }
    }
  });
  it("every non-English string is a DRAFT (nobody who reads the language has marked one reviewed)", () => {
    for (const k of keys) for (const l of TRANSLATED_LANGS) expect(data[k].status[l], `${k}:${l}`).toBe("draft");
  });
  it("uses each language's own script, except the strings that must stay English until a person reviews them", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    for (const l of TRANSLATED_LANGS) expect(keys.filter((k) => !data[k].humanOnly && !script[l].test(dicts[l][k])), l).toEqual([]);
  });
  it("the strings no machine may translate (money rules, privacy and erasure, do-not-contact) show the English in every language", () => {
    expect(keys.filter((k) => data[k].humanOnly).sort()).toEqual(HUMAN_ONLY);
    for (const k of HUMAN_ONLY) for (const l of TRANSLATED_LANGS) expect(dicts[l][k], `${k}:${l}`).toBe(dicts.en[k]);
  });
  it("makes no claim we cannot prove, never hard-codes the brand name", () => {
    for (const l of LANGS) for (const k of keys) {
      for (const [re, label] of FORBIDDEN) expect(re.test(dicts[l][k]), `${l}:${k} contains ${label}`).toBe(false);
      expect(dicts[l][k]).not.toMatch(/sme-?ai/i);
    }
  });
  it("English parity: the English words are exactly the menu table's words", () => {
    for (const g of NAV) {
      expect(appDict("en")[`nav.group.${g.id}` as keyof typeof app], g.id).toBe(g.label);
      for (const i of g.items) expect(appDict("en")[`nav.item.${i.id}` as keyof typeof app], i.id).toBe(i.label);
    }
    for (const i of FOOT) expect(appDict("en")[`nav.item.${i.id}` as keyof typeof app], i.id).toBe(i.label);
  });
  it("fills a placeholder and ships the dictionary of ONE language as props", () => {
    expect(appT("en")("frame.aileft", { amount: "₹310" })).toBe("₹310 left today");
    expect(appT("te")("frame.aileft", { amount: "₹310" })).toContain("₹310");
    expect(Object.keys(frameLabels("te")).length).toBe(keys.length);
  });
  it("is server only: no client component imports it (all four dictionaries would land in the browser bundle)", () => {
    const WEB = path.resolve(import.meta.dirname, "..");
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const clients = [...walk(path.join(WEB, "components")), ...walk(path.join(WEB, "app"))].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(10);
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/i18n\/(app|auth|landing)"|@\/i18n\/strings\/app\.json/);
  });
});
