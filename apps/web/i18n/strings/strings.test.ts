import { describe, expect, it } from "vitest";
import site from "@/i18n/strings/site.json";
import legal from "@/i18n/strings/legal.json";
import login from "@/i18n/strings/login.json";
import { LANGS } from "@/i18n/lang";
import { TRANSLATED_LANGS, dictFor, keepHyphenatedWordsWhole } from "@/i18n/strings";
import { FORBIDDEN_CLAIMS as FORBIDDEN } from "@/i18n/strings/forbidden";

type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string>; only?: string[] };
const SETS: Record<string, Record<string, Entry>> = { site, login, legal } as never;
const langsOf = (e: Entry) => e.only ?? [...TRANSLATED_LANGS];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("string store: four languages", () => {
  for (const [name, data] of Object.entries(SETS)) {
    const dicts = Object.fromEntries(LANGS.map((l) => [l, dictFor(data as never, l) as Record<string, string>]));
    const keys = Object.keys(data);
    it(`${name}: the same keys in English, Telugu, Hindi and Kannada`, () => {
      for (const lang of LANGS) expect(Object.keys(dicts[lang]).sort(), `${name}:${lang}`).toEqual([...keys].sort());
    });
    it(`${name}: no empty string, and the same {placeholders} everywhere`, () => {
      for (const lang of LANGS)
        for (const k of keys) {
          expect(dicts[lang][k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
          expect(placeholders(dicts[lang][k]), `${lang}:${k}`).toEqual(placeholders(dicts.en[k]));
        }
    });
    it(`${name}: the other languages use their own script`, () => {
      const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
      const exempt = /^(langs\.sample\.|theme\.|meta\.description|foot\.copy|legal\.draft\.banner|role\.main\.t$|nav\.whatsapp$|owl\.name\.)/; // intentionally Latin or numeric (role.main.t is the product name "Agent OWL")
      for (const lang of ["te", "hi", "kn"] as const) {
        const missing = keys.filter((k) => !exempt.test(k) && !script[lang].test(dicts[lang][k]));
        expect(missing, `${name}:${lang}`).toEqual([]);
      }
    });
    it(`${name}: never hard-codes the brand name (it comes from {brand})`, () => {
      for (const lang of LANGS) for (const k of keys) expect(dicts[lang][k], `${lang}:${k}`).not.toMatch(/sme-?ai/i);
    });
  }
});

describe("honesty: no claims we cannot prove today", () => {
  for (const [name, data] of Object.entries(SETS)) {
    for (const lang of LANGS) {
      it(`${name} / ${lang}: no forbidden claim`, () => {
        const d = dictFor(data as never, lang) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) for (const [re, label] of FORBIDDEN) expect(re.test(v), `${name}:${lang}:${k} contains ${label}: "${v}"`).toBe(false);
      });
    }
  }
  const en = dictFor(site, "en") as Record<string, string>;
  it("the English home copy says what it must: money talk waits for the owner, sending is automatic only when switched on, and that sign-up is open and free", () => {
    expect(en["hero.sub"]).toMatch(/price, promises or complaints waits for your OK/i);
    expect(en["faq.1.a"]).toMatch(/Only if you switch automatic sending on/);
    expect(en["faq.1.a"]).toMatch(/waits for your OK, and calls always wait/);
    expect(en["faq.3.a"]).toMatch(/does not calculate or change a price/);
    expect(en["hero.note"]).toBe("You can sign up and try it free. Nothing is charged.");
    for (const k of Object.keys(en)) expect(en[k], k).not.toMatch(/invitation only|by invitation|early access/i); // sign-up is open (Job AC review)
    expect(en["hero.cta"]).toBe("Start free, choose your business");
  });
  it("the pricing copy never counts questions, says billing is off, and holds no price inside a sentence (the prices are numbers in lib/site/plans.ts)", () => {
    expect(en["price.sub"]).toMatch(/No charge for each question/);
    expect(en["price.billing"]).toMatch(/Billing is not switched on yet/);
    expect(en["price.faq.3.a"]).toMatch(/Billing is off/);
    for (const k of Object.keys(en).filter((x) => x.startsWith("price.") || x.startsWith("teaser."))) expect(en[k], k).not.toMatch(/₹|\d{3}/);
  });
  it("the security copy claims only what exists and says what does not", () => {
    expect(en["sec.rights.d"]).toMatch(/not had an independent review/);
    expect(en["sec.where.d"]).toMatch(/not hosted for real customers yet/);
    expect(en["sec.kids.d"]).toMatch(/waits for a legal review/);
    for (const k of Object.keys(en).filter((x) => x.startsWith("sec."))) expect(en[k], k).not.toMatch(/compliant|certified|audited|encrypted/i);
  });
});

describe("string store: status", () => {
  it("every string has a draft or reviewed status for each language it exists in", () => {
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        for (const l of langsOf(e)) expect(["draft", "reviewed"], `${set}.${key}:${l}`).toContain(e.status[l]);
        for (const l of Object.keys(e.status)) expect(langsOf(e), `${set}.${key} has a status for ${l}`).toContain(l);
      }
    }
  });
  it("dictFor builds one flat dictionary per language", () => {
    const te = dictFor(login, "te");
    expect(Object.keys(te)).toEqual(Object.keys(login));
    expect(te["signin.title"]).toBe(keepHyphenatedWordsWhole(login["signin.title"].te));
  });
});

// The register brief (i18n/STYLE.md) bans bookish words. A guard, not the whole style.
const BANNED: Record<"te" | "hi" | "kn", string[]> = {
  te: ["దయచేసి", "తెలియజేయ", "ఆమోదించ", "సమాధానం", "నమోదు", "పరిశోధ", "సందేశం", "చెల్లింపు", "వినియోగదారు", "ధృవీకరించ", "అభ్యర్థన", "ఏజెంట్"],
  hi: ["कृपया", "निर्णय", "संदेश", "भुगतान", "अग्रिम", "उपभोक्ता", "प्रतीक्षा", "पंजीकरण", "सत्यापित", "अनुरोध", "उपयोगकर्ता", "प्रदर्शित", "अनुमोदित", "एजेंट"],
  kn: ["ದಯವಿಟ್ಟು", "ನಿರ್ಧಾರ", "ಸಂದೇಶ", "ಅನುಮೋದ", "ಪಾವತಿ", "ದಾಖಲಿಸ", "ದಾಖಲಾಗ", "ಪರಿಶೀಲ", "ಬಳಕೆದಾರ", "ಧೃಢೀಕರ", "ಏಜೆಂಟ್", "ಮನವಿ"],
};
describe("string store: everyday register", () => {
  it("none of the Telugu, Hindi or Kannada strings uses a bookish word from the style brief", () => {
    const hits: string[] = [];
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        for (const l of langsOf(e) as ("te" | "hi" | "kn")[]) {
          for (const w of BANNED[l]) if (e[l].includes(w)) hits.push(`${set}.${key}:${l} has "${w}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
  it("keeps sentences short: no string is a wall of text", () => {
    const long: string[] = [];
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        if (/^meta\.description$/.test(key)) continue;
        for (const l of langsOf(e) as ("te" | "hi" | "kn")[]) {
          const words = e[l].split(/\s+/).length;
          if (words > 45) long.push(`${set}.${key}:${l} has ${words} words`);
        }
      }
    }
    expect(long).toEqual([]);
  });
});

describe("string store: no bad hyphen wrap", () => {
  it("puts an invisible word joiner after a hyphen between two letters, in te / hi / kn only", () => {
    expect(keepHyphenatedWordsWhole("फ़ॉलो-अप")).toBe("फ़ॉलो-⁠अप");
    expect(keepHyphenatedWordsWhole("ఫాలో-అప్ డ్రాఫ్ట్")).toBe("ఫాలో-⁠అప్ డ్రాఫ్ట్");
    expect(keepHyphenatedWordsWhole("GST 5% - ok")).toBe("GST 5% - ok");
    expect(dictFor(site, "en")["nav.how"]).toBe(site["nav.how"].en);
  });
  it("inserts only U+2060 (word joiner), never ZWJ or ZWNJ: without it every built string equals the stored text", () => {
    for (const [set, data] of Object.entries({ site, login })) {
      for (const l of ["te", "hi", "kn"] as const) {
        const d = dictFor(data as never, l) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) {
          const raw = (data as unknown as Record<string, Record<string, string>>)[k][l];
          expect(v.replaceAll("⁠", ""), `${set}.${k}:${l}`).toBe(raw);
          for (const c of [...v].filter((ch) => !raw.includes(ch))) expect(c, `${set}.${k}:${l}`).toBe("⁠");
        }
      }
    }
  });
  it("leaves no breakable hyphen between letters in any built dictionary", () => {
    const bad: string[] = [];
    for (const [set, data] of Object.entries({ site, login })) {
      for (const l of ["te", "hi", "kn"] as const) {
        const d = dictFor(data as never, l) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) if (/[\p{L}\p{M}]-[\p{L}\p{M}]/u.test(v)) bad.push(`${set}.${k}:${l}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
