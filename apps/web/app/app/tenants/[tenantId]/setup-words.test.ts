import { DEFAULT_NAME_BY_LANG } from "@/lib/assistant/default-name";
import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";

import { setupWords } from "./setup-words";

describe("setupWords (job BJ)", () => {
  it.each(LANGS)("%s: every setup string, and the existing ones the wizard reuses", (lang) => {
    const w = setupWords(lang);
    expect(Object.keys(w).filter((k) => k.startsWith("setup.")).length).toBeGreaterThanOrEqual(50);
    for (const k of ["catalogue.fabric.kanchi_pattu", "catalogue.colour.maroon", "catalogue.zari.rich", "catalogue.photo.err.net", "catalogue.err.name", "visits.hours.order", "visits.hours.save", "agentset.sending.on", "today.err.generic"]) expect(w[k], k).toBeTruthy();
    expect(Object.keys(w).some((k) => k.startsWith("outbox.") || k.startsWith("settings."))).toBe(false); // only what the wizard needs reaches the browser
  });
  it("Telugu, Hindi and Kannada have every setup string translated (the money, sending and 'what waits' lines too, approved 26 Nov 2026)", () => {
    const en = appDict("en") as Record<string, string>;
    for (const lang of ["te", "hi", "kn"] as const) {
      const d = appDict(lang) as Record<string, string>;
      for (const k of Object.keys(en).filter((x) => x.startsWith("setup."))) {
        expect(d[k], `${lang}:${k}`).not.toBe(en[k]); // (26 Nov 2026: written and approved in all three languages, the money and "what waits" lines included)
        for (const ph of en[k].match(/\{\w+\}/g) ?? []) expect(d[k], `${lang}:${k}`).toContain(ph);
      }
    }
  });
});
