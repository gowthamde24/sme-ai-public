import { afterEach, describe, expect, it, vi } from "vitest";

import app from "./app.json";
import { dictFor, reviewedOnly } from "./index";

const DATA = {
  "a.one": { en: "Today", te: "ఈరోజు", hi: "आज", kn: "ಇಂದು", status: { te: "reviewed", hi: "draft", kn: "draft" } },
  "a.two": { en: "Needs you", te: "మీరు చూడాలి", hi: "आपको देखना है", kn: "ನೀವು ನೋಡಬೇಕು", status: { te: "draft", hi: "reviewed", kn: "draft" } },
} as const;

afterEach(() => vi.unstubAllEnvs());

describe("reviewed-only mode (Customer Zero: REVIEWED_TRANSLATIONS_ONLY=1)", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(reviewedOnly()).toBe(false);
    vi.stubEnv("REVIEWED_TRANSLATIONS_ONLY", "true");
    expect(reviewedOnly()).toBe(false);
    vi.stubEnv("REVIEWED_TRANSLATIONS_ONLY", "1");
    expect(reviewedOnly()).toBe(true);
  });
  it("off: the drafts show in every language", () => {
    expect(dictFor(DATA, "te")["a.two"]).toBe("మీరు చూడాలి");
    expect(dictFor(DATA, "hi")["a.one"]).toBe("आज");
  });
  it("on: only the strings reviewed in THAT language show it; every other string shows its English", () => {
    vi.stubEnv("REVIEWED_TRANSLATIONS_ONLY", "1");
    expect(dictFor(DATA, "te")).toEqual({ "a.one": "ఈరోజు", "a.two": "Needs you" });
    expect(dictFor(DATA, "hi")).toEqual({ "a.one": "Today", "a.two": "आपको देखना है" });
    expect(dictFor(DATA, "kn")).toEqual({ "a.one": "Today", "a.two": "Needs you" });
    expect(dictFor(DATA, "en")).toEqual({ "a.one": "Today", "a.two": "Needs you" });
  });
  it("on: the real app store never shows an empty string or a bare key in any language, and Telugu shows only what is reviewed", () => {
    vi.stubEnv("REVIEWED_TRANSLATIONS_ONLY", "1");
    for (const lang of ["te", "hi", "kn"] as const) {
      const dict = dictFor(app as never, lang) as Record<string, string>;
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim().length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(v, `${lang}:${k} is the key`).not.toBe(k);
        const reviewed = (app as Record<string, { status: Record<string, string> }>)[k].status[lang] === "reviewed";
        if (!reviewed) expect(v, `${lang}:${k} is English until reviewed`).toBe((app as Record<string, { en: string }>)[k].en);
      }
    }
  }, 60_000);
});
