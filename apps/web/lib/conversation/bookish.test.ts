import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { CONV_WORD_SETS } from "./word-sets";

/**
 * The owner's rule (14 Nov 2026, "no bookish Telugu"): what the assistant's cards, buttons and status lines say in Telugu, Kannada and Hindi is SPOKEN language with English business words ("కాల్ చెయ్యనా?"), never the written forms ("చేయవచ్చునా", "ఫోన్ కాల్ ద్వారా", "కొనసాగించమంటారా"). This test reads every string the conversation word sets serve (plus the Talk live and voice prefixes) and fails on the known written forms; add a form here when the owner names one.
 */
const BOOKISH: Record<"te" | "kn" | "hi", readonly string[]> = {
  te: ["విచారణ", "చేయవచ్చునా", "ప్రాప్త", "కొనసాగించ", "ద్వారా", "నిర్వహించ", "తెలియజేయ"],
  kn: ["ವಿಚಾರಣೆ", "ಬಹುದೇ", "ಮುಂದುವರಿಸ", "ಮೂಲಕ"],
  hi: ["पूछताछ", "प्राप्त", "द्वारा"],
};
const PREFIXES = [...CONV_WORD_SETS.talk, ...CONV_WORD_SETS.task, "dst.", "tv6.talk.", "bv."];

describe("no bookish forms in the conversation's words", () => {
  for (const lang of ["te", "kn", "hi"] as const) {
    it(`${lang}: spoken words and English business words only`, () => {
      const dict = appDict(lang) as Record<string, string>;
      const hits = Object.entries(dict)
        .filter(([k]) => PREFIXES.some((p) => k.startsWith(p)))
        .flatMap(([k, v]) => BOOKISH[lang].filter((w) => v.includes(w)).map((w) => `${k}: ${w}`));
      expect(hits).toEqual([]);
    });
  }
});
