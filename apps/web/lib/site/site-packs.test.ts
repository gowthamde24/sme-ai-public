// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_CLAIMS } from "@/i18n/strings/forbidden";
import { LANGS } from "@/i18n/lang";

import { SITE_PACKS } from "./packs";
import type { Text } from "./types";
import { OUT, PACKS_DIR, buildSitePacks, render } from "../../scripts/site-packs.mjs";

const WEB = path.resolve(import.meta.dirname, "..", "..");

/** Every {en, te, hi, kn} text in a landing block. */
function texts(node: unknown, found: { path: string; text: Text }[] = [], at = ""): { path: string; text: Text }[] {
  if (Array.isArray(node)) node.forEach((v, i) => texts(v, found, `${at}[${i}]`));
  else if (typeof node === "object" && node !== null) {
    const o = node as Record<string, unknown>;
    if (typeof o.en === "string") found.push({ path: at, text: o as unknown as Text });
    else for (const [k, v] of Object.entries(o)) if (!["id", "slug", "icon", "owl", "time", "accent", "owlProp", "status", "validated", "default_wastage_bps", "truck_capacity_pieces", "pieces_per_area_x1000", "pieces_per_pallet", "from"].includes(k)) texts(v, found, `${at}/${k}`);
  }
  return found;
}
const all = SITE_PACKS.flatMap((p) => texts({ meta: p.meta, hero: p.hero, problem: p.problem, day: p.day, features: p.features, faq: p.faq, plan_fit: p.plan_fit, calculator: p.calculator, children_promise: p.children_promise }, [], p.slug));

describe("the public site's copy of the landing blocks (generated from packages/packs)", () => {
  it("is fresh: it is exactly what pack.json and landing.json give (run `make site-packs`)", () => {
    expect(fs.readFileSync(OUT, "utf8")).toBe(render(buildSitePacks(PACKS_DIR)));
  });
  it("has a page for every business type that has a landing.json and is not a draft, reviewed ones first, with its address", () => {
    expect(SITE_PACKS.length).toBeGreaterThanOrEqual(3);
    expect(SITE_PACKS[0].validated).toBe(true);
    expect(new Set(SITE_PACKS.map((p) => p.slug)).size).toBe(SITE_PACKS.length);
    for (const p of SITE_PACKS) expect(p.slug).toMatch(/^[a-z][a-z0-9-]{1,30}$/);
  });
  it("says every text in English, Telugu, Hindi and Kannada, each in its own script", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    const bad: string[] = [];
    for (const { path: p, text } of all) {
      for (const l of LANGS) if (!text[l]?.trim()) bad.push(`${p}:${l} missing`);
      for (const l of ["te", "hi", "kn"] as const) if (text[l] && !script[l].test(text[l]!) && !/^[A-Z ]+$/.test(text.en)) bad.push(`${p}:${l} not in its script`);
    }
    expect(bad).toEqual([]);
  });
  it("keeps the same {placeholders} in every language, and only {brand} and {assistant}", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const { path: p, text } of all) {
      for (const l of LANGS) expect(ph(text[l] ?? ""), `${p}:${l}`).toEqual(ph(text.en));
      for (const name of ph(text.en)) expect(["brand", "assistant"], p).toContain(name);
    }
  });
  it("makes no claim we cannot prove, no price and no percentage (the honesty rules of every other page)", () => {
    for (const { path: p, text } of all) for (const l of LANGS) for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(text[l] ?? ""), `${p}:${l} contains ${label}`).toBe(false);
    for (const { path: p, text } of all) expect(text.en, p).not.toMatch(/₹/);
  });
  it("uses no bookish word from the style brief in Telugu, Hindi or Kannada", () => {
    const banned = { te: ["దయచేసి", "తెలియజేయ", "ఆమోదించ", "సమాధానం", "నమోదు", "సందేశం", "చెల్లింపు", "వినియోగదారు", "ధృవీకరించ", "అభ్యర్థన", "ఏజెంట్"], hi: ["कृपया", "निर्णय", "संदेश", "भुगतान", "अग्रिम", "उपभोक्ता", "पंजीकरण", "सत्यापित", "अनुरोध", "उपयोगकर्ता", "एजेंट"], kn: ["ದಯವಿಟ್ಟು", "ನಿರ್ಧಾರ", "ಸಂದೇಶ", "ಅನುಮೋದ", "ಪಾವತಿ", "ದಾಖಲಿಸ", "ಪರಿಶೀಲ", "ಬಳಕೆದಾರ", "ಏಜೆಂಟ್", "ಮನವಿ"] } as const;
    const hits: string[] = [];
    for (const { path: p, text } of all) for (const l of ["te", "hi", "kn"] as const) for (const w of banned[l]) if (text[l]?.includes(w)) hits.push(`${p}:${l} has ${w}`);
    expect(hits).toEqual([]);
  });
  it("keeps every sentence short, and names the product only as {brand}", () => {
    for (const { path: p, text } of all) {
      for (const l of LANGS) expect((text[l] ?? "").split(/\s+/).length, `${p}:${l}`).toBeLessThanOrEqual(50);
      for (const l of LANGS) expect(text[l] ?? "", `${p}:${l}`).not.toMatch(/sme-?ai/i);
    }
  });
  it("is used by no client component (all four languages of every page would reach the browser)", () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", ".next", "test"].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const clients = ["app", "components", "lib"].flatMap((d) => walk(path.join(WEB, d))).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(20);
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/i18n\/site["']|@\/lib\/site\/(packs|routes|whatsapp|lead-limit)["']|site-packs\.generated/);
  });
});
