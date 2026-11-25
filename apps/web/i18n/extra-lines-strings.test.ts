import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import site from "@/i18n/strings/site.json";
import { PLAN_FACTS, planVars } from "@/lib/site/plans";

/**
 * The words of extra lines (`ln.`: Add a line, the price, the lines bought; owner, 26 Nov 2026): in English, Telugu, Hindi and Kannada with the same {placeholders}, each in its own script, all DRAFTS until a person
 * who reads the language reviews them (the way every new string is marked); the price is always a {price} placeholder (the number comes from the API, never typed in a string); no fill-in-the-blank brackets.
 */
type Entry = { en: string; te: string; hi: string; kn: string; ta?: string; status: Record<string, string> };
const dict = app as unknown as Record<string, Entry>;
const keys = Object.keys(dict).filter((k) => k.startsWith("ln."));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const SCRIPT = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
const OTHER = { te: [SCRIPT.hi, SCRIPT.kn], hi: [SCRIPT.te, SCRIPT.kn], kn: [SCRIPT.te, SCRIPT.hi] } as const;

describe("the extra-lines strings", () => {
  it("has the strings the card draws", () => {
    for (const k of ["ln.add.title", "ln.price", "ln.taken", "ln.confirm", "ln.later", "ln.done", "ln.credits", "ln.list.title", "ln.row.name", "ln.row.renews", "ln.row.ends", "ln.row.grace", "ln.row.paused", "ln.row.cancel", "ln.row.keep", "ln.err.not_enough_credits", "ln.err.unavailable"]) expect(keys, k).toContain(k);
  });
  it("every key has all four languages, the same {placeholders}, and the three others in their own script", () => {
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
  it("Telugu, Hindi and Kannada are DRAFTS for the owner's reviewer", () => {
    for (const k of keys) {
      expect({ hi: dict[k].status.hi, kn: dict[k].status.kn }, k).toEqual({ hi: "draft", kn: "draft" });
      expect(["draft", "reviewed"]).toContain(dict[k].status.te);
    } // Telugu is approved (owner, 26 Nov 2026)
  });
  it("the price is a placeholder, never typed; Telugu says క్రెడిట్స్ and keeps the business words in English", () => {
    expect(dict["ln.price"].en).toContain("{price}");
    for (const k of keys) {
      for (const lang of ["en", "te", "hi", "kn"] as const) expect(dict[k][lang], `${k}:${lang}`).not.toMatch(/\d{3}/);
    }
    expect(dict["ln.credits"].te).toContain("క్రెడిట్స్");
    for (const k of keys) expect(dict[k].te, k).not.toMatch(/సందేశం|దయచేసి|నిర్ణయం/);
  });
  it("the English is plain: no fill-in-the-blank brackets, no ids, no jargon", () => {
    for (const k of keys) expect(dict[k].en, k).not.toMatch(/\[[^\]]*\]|\bAPI\b|\bDLT\b|\bDND\b|\bVoiceLink\b|\bPlivo\b|\bchannel\b/i);
  });
});

describe("the Pricing page row", () => {
  const row = (site as unknown as Record<string, Entry & { ta: string }>)["pp.sh.lines"] as Entry & { ta: string };
  it("is one plain row in English, Telugu, Hindi, Kannada and Tamil, the number a placeholder, drafts", () => {
    expect(row.en).toBe("Extra calls at once: ₹{line} per line per month");
    for (const lang of ["te", "hi", "kn", "ta"] as const) {
      expect(row[lang].trim().length).toBeGreaterThan(0);
      expect(placeholders(row[lang]), lang).toEqual(["line"]);
      expect(row.status[lang], lang).toBe(lang === "te" ? "reviewed" : "draft"); // Telugu approved by the owner, 26 Nov 2026
    }
  });
  it("takes its number from the plan facts, the same one the app's price comes from", () => {
    expect(PLAN_FACTS.extraLine).toBe(149);
    expect(planVars().line).toBe("149");
  });
});
