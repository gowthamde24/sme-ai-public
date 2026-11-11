import { describe, expect, it } from "vitest";

import { parseHowSpeaks, speaksProblem, speaksToApi, toneFromLegacy } from "./speaks";

const lang = (style = "everyday_mixed", region = "neutral") => ({ style, region, saved: false, examples: "approved" });
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "saved", pack_default: "friendly", options: ["respectful", "friendly"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: {} },
  introduce_as: { kind: "owner", text: "Gowtham", owner_name: "Gowtham" },
  pack_defaults: { tone: "friendly" },
  legacy_address: "garu",
  updated_at: "2026-11-11T10:00:00Z",
  ...over,
});

describe("How your assistant speaks (C1's fixed contract): the shapes and the rules", () => {
  it("reads the object; formal is shown as everyday_pure; a region of another language is neutral; an odd answer is null", () => {
    const h = parseHowSpeaks(RAW({ words: { languages: { te: lang("formal", "telangana"), kn: lang("everyday_pure", "telangana"), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: {} } }));
    expect(h).toMatchObject({ tone: { value: "friendly", source: "saved", packDefault: "friendly" }, introduceAs: { kind: "owner", text: "Gowtham", ownerName: "Gowtham" }, legacyAddress: "garu" });
    expect(h?.words.te).toMatchObject({ style: "everyday_pure", region: "telangana" }); // formal is hidden: read as everyday_pure
    expect(h?.words.kn.region).toBe("neutral"); // telangana is not a Kannada region
    expect(parseHowSpeaks(RAW({ tone: { value: "casual", source: "saved", pack_default: "friendly" } }))).toBeNull(); // casual is not a tone here
    expect(parseHowSpeaks(RAW({ introduce_as: { kind: "robot" } }))).toBeNull();
    expect(parseHowSpeaks({ nope: 1 })).toBeNull();
    expect(parseHowSpeaks(RAW({ legacy_address: "x" }))?.legacyAddress).toBeNull();
    expect(parseHowSpeaks(RAW({ introduce_as: { kind: "business", text: null, owner_name: " " } }))?.introduceAs.ownerName).toBeNull();
  });
  it("the contract's migration of the old address: plain is the business type's usual, sir_madam, garu and ji are Respectful", () => {
    expect(toneFromLegacy("plain", "friendly")).toBe("friendly");
    expect(toneFromLegacy(null, "respectful")).toBe("respectful"); // a school that never touched it is not forced to Friendly
    for (const a of ["sir_madam", "garu", "ji"] as const) expect(toneFromLegacy(a, "friendly")).toBe("respectful");
  });
  it("a change is checked with the contract's rules: tone respectful, friendly or null (never casual), words per language with its own regions, Introduce as with its rules", () => {
    expect(speaksProblem({ tone: "respectful" })).toBeNull();
    expect(speaksProblem({ tone: null })).toBeNull();
    expect(speaksProblem({ tone: "casual" })).toBe("tone");
    expect(speaksProblem({ words: { te: { style: "everyday_pure", region: "telangana" }, ta: { region: "kongu" } } })).toBeNull();
    expect(speaksProblem({ words: { te: { style: "formal" } } })).toBe("style");
    expect(speaksProblem({ words: { kn: { region: "coastal" } } })).toBe("region");
    expect(speaksProblem({ words: { ml: { style: "everyday_pure" } } })).toBe("language");
    expect(speaksProblem({ words: { te: {} } })).toBe("language");
    expect(speaksProblem({ introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } })).toBeNull();
    expect(speaksProblem({ introduceAs: { kind: "custom", text: "a human AI assistant" } })).toBe("introduce");
    expect(speaksProblem({})).toBe("empty");
    expect(speaksProblem({ tone: "friendly", extra: 1 })).toBe("empty");
    expect(speaksProblem(null)).toBe("empty");
  });
  it("the PUT body is the contract's own: tone, words by language, introduce_as; null resets the tone", () => {
    expect(speaksToApi({ tone: null, words: { te: { region: "coastal" } }, introduceAs: { kind: "business", text: null } })).toEqual({ tone: null, words: { te: { region: "coastal" } }, introduce_as: { kind: "business", text: null } });
    expect(speaksToApi({})).toEqual({});
  });
});
