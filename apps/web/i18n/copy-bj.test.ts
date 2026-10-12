import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";
import { landingDict } from "@/i18n/landing";
import { FORBIDDEN_CLAIMS } from "@/i18n/strings/forbidden";

describe("the two copy fixes of job BJ", () => {
  it("the Ask box line says Agent OWL answers in writing, and out loud if voice is turned on", () => {
    expect(appDict("en")["ask.hero.note"]).toBe("Speak or type in Telugu, Hindi, Kannada or English. Agent OWL answers in writing, and out loud if you turn voice on.");
    for (const lang of ["te", "hi", "kn"] as const) {
      const d = appDict(lang)["ask.hero.note"];
      expect(d, lang).not.toBe(appDict("en")["ask.hero.note"]);
      expect(d, lang).toContain("Agent OWL");
      expect(d, lang).toMatch(/వాయిస్|वॉइस|ವಾಯ್ಸ್/); // the voice switch is named in the language
    }
  });
  it("the landing FAQ says when Agent OWL sends by itself and that money, complaints and calls always wait, in all four languages", () => {
    // the landing page was rewritten in job BS: same facts, new words
    expect(landingDict("en")["faq.1.a"]).toMatch(/Only if you switch automatic sending on/);
    expect(landingDict("en")["faq.1.a"]).toMatch(/price, promises or complaints waits for your OK, and calls always wait/);
    for (const lang of LANGS) {
      const a = landingDict(lang)["faq.1.a"];
      expect(a, lang).not.toMatch(/Nothing is sent automatically|ఏదీ దానంతట అదే వెళ్ళదు|कुछ भी अपने आप नहीं जाता|ಏನೂ ತಾನಾಗಿ ಹೋಗುವುದಿಲ್ಲ/); // the old, no-longer-true answer
      for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(a), `${lang} ${label}`).toBe(false);
    }
  });
});
