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
  it("Telugu, Hindi and Kannada have every setup string translated, except the money, sending and 'what waits' lines, which stay English on purpose", () => {
    const en = appDict("en") as Record<string, string>;
    const stay = ["setup.s4.waits.title", "setup.s4.waits.money", "setup.s4.waits.complaints", "setup.s4.waits.calls", "setup.s4.auto", "setup.s4.quiet"];
    for (const lang of ["te", "hi", "kn"] as const) {
      const d = appDict(lang) as Record<string, string>;
      for (const k of Object.keys(en).filter((x) => x.startsWith("setup."))) {
        if (stay.includes(k)) expect(d[k], `${lang}:${k}`).toBe(en[k]);
        else expect(d[k], `${lang}:${k}`).not.toBe(en[k]);
        for (const ph of en[k].match(/\{\w+\}/g) ?? []) expect(d[k], `${lang}:${k}`).toContain(ph);
      }
    }
  });
});
