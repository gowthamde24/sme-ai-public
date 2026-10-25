import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";
import { siteDict } from "@/i18n/site";
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
  it("the public site says that money waits for the owner, that automatic sending is a switch, and that calls always wait, in all four languages", () => {
    // job CX took the FAQ off the home page: the home hero and the How it works page now carry these facts
    expect(siteDict("en")["hm.ctl.d"]).toMatch(/money reminders and discounts wait for your approval/); // job DM: the redesigned home page says it in the "You stay in control" line
    expect(siteDict("en")["how.habits.5"]).toMatch(/One switch turns automatic sending off\. Then every message waits for you/);
    expect(siteDict("en")["how.waits.4"]).toMatch(/Calls: you approve the call list first/);
    for (const lang of LANGS) {
      for (const key of ["hm.ctl.d", "how.habits.5", "how.waits.4"] as const) {
        const a = siteDict(lang)[key];
        expect(a, `${lang} ${key}`).not.toMatch(/Nothing is sent automatically|ఏదీ దానంతట అదే వెళ్ళదు|कुछ भी अपने आप नहीं जाता|ಏನೂ ತಾನಾಗಿ ಹೋಗುವುದಿಲ್ಲ/); // the old, no-longer-true answer
        for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(a), `${lang} ${key} ${label}`).toBe(false);
      }
    }
  });
});
