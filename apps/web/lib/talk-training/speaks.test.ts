import { describe, expect, it } from "vitest";

import { parseHowSpeaks, speaksProblem, speaksToApi, toneFromLegacy } from "./speaks";

const lang = (style = "everyday_mixed") => ({ style, saved: false, examples: "approved" });
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "saved", pack_default: "friendly", options: ["friendly", "respectful", "quick"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: {} },
  introduce_as: { kind: "owner", text: "Gowtham", owner_name: "Gowtham" },
  pack_defaults: { tone: "friendly" },
  legacy_address: "garu",
  updated_at: "2026-11-11T10:00:00Z",
  ...over,
});

describe("How your assistant speaks (C1's fixed contract): the shapes and the rules", () => {
  it("reads the object; formal is shown as everyday_pure; the three tones; an odd answer is null", () => {
    const h = parseHowSpeaks(RAW({ words: { languages: { te: lang("formal"), kn: lang("everyday_pure"), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: {} } }));
    expect(h).toMatchObject({ tone: { value: "friendly", source: "saved", packDefault: "friendly" }, introduceAs: { kind: "owner", text: "Gowtham", ownerName: "Gowtham" }, legacyAddress: "garu" });
    expect(h?.words.te).toMatchObject({ style: "everyday_pure" }); // formal is hidden: read as everyday_pure
    expect(h?.words.te).not.toHaveProperty("region"); // there is no Region any more (C1, 21 Nov 2026)
    expect(parseHowSpeaks(RAW({ tone: { value: "quick", source: "saved", pack_default: "friendly" } }))?.tone.value).toBe("quick");
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
  it("a change is checked with the contract's rules: tone friendly, respectful, quick or null (never casual), words per language, the background, the AI switch, Introduce as with its rules", () => {
    expect(speaksProblem({ tone: "respectful" })).toBeNull();
    expect(speaksProblem({ tone: null })).toBeNull();
    expect(speaksProblem({ tone: "casual" })).toBe("tone");
    expect(speaksProblem({ tone: "quick" })).toBeNull();
    expect(speaksProblem({ words: { te: { style: "everyday_pure" }, ta: { style: "everyday_mixed" } } })).toBeNull();
    expect(speaksProblem({ words: { te: { style: "formal" } } })).toBe("style");
    expect(speaksProblem({ words: { kn: { region: "coastal" } } })).toBe("language"); // Region is gone
    expect(speaksProblem({ background: "shop" })).toBeNull();
    expect(speaksProblem({ background: null })).toBeNull();
    expect(speaksProblem({ background: "stadium" })).toBe("background");
    expect(speaksProblem({ sayAi: true })).toBeNull();
    expect(speaksProblem({ sayAi: "yes" })).toBe("say_ai");
    expect(speaksProblem({ sayAi: false })).toBe("say_ai_undertaking"); // off only with the written undertaking
    expect(speaksProblem({ sayAi: false, sayAiUndertaking: true })).toBeNull();
    expect(speaksToApi({ sayAi: false, sayAiUndertaking: true })).toEqual({ say_ai_when_greeting: false, say_ai_undertaking: { accepted: true } });
    expect(speaksProblem({ words: { ml: { style: "everyday_pure" } } })).toBe("language");
    expect(speaksProblem({ words: { te: {} } })).toBe("language");
    expect(speaksProblem({ introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } })).toBeNull();
    expect(speaksProblem({ introduceAs: { kind: "custom", text: "a human AI assistant" } })).toBe("introduce");
    expect(speaksProblem({})).toBe("empty");
    expect(speaksProblem({ tone: "friendly", extra: 1 })).toBe("empty");
    expect(speaksProblem(null)).toBe("empty");
  });
  it("the PUT body is the contract's own: tone, words by language, introduce_as, background, say_ai_when_greeting; null resets", () => {
    expect(speaksToApi({ tone: null, words: { te: { style: "everyday_pure" } }, introduceAs: { kind: "business", text: null } })).toEqual({ tone: null, words: { te: { style: "everyday_pure" } }, introduce_as: { kind: "business", text: null } });
    expect(speaksToApi({ background: "shop", sayAi: true })).toEqual({ background: "shop", say_ai_when_greeting: true });
    expect(speaksToApi({ background: null, sayAi: null })).toEqual({ background: null, say_ai_when_greeting: null });
    expect(speaksToApi({})).toEqual({});
  });
  it("background and the AI switch are read when the API has them and are null when it has not (nothing is drawn then)", () => {
    expect(parseHowSpeaks(RAW())).toMatchObject({ background: null, sayAi: null });
    const bg = { value: "shop", saved: true, options: [{ id: "quiet_office", label: { en: "Quiet office", te: "ప్రశాంతమైన ఆఫీస్" } }, { id: "shop", label: { en: "Shop" } }, { id: "off", label: { en: "Off" } }, { id: "stadium", label: { en: "Stadium" } }] };
    const h = parseHowSpeaks(RAW({ background: bg, say_ai_when_greeting: { value: true, saved: true } }));
    expect(h?.background).toMatchObject({ value: "shop", saved: true });
    expect(h?.background?.options.map((o) => o.id)).toEqual(["quiet_office", "shop", "off"]); // a word the web does not know is left out
    expect(h?.background?.options[0].label.te).toBe("ప్రశాంతమైన ఆఫీస్");
    expect(h?.sayAi).toEqual({ value: true, saved: true, undertakingAt: null });
    expect(parseHowSpeaks(RAW({ background: { value: "stadium", options: [] } }))?.background).toBeNull();
    expect(parseHowSpeaks(RAW({ say_ai_when_greeting: { value: "yes" } }))?.sayAi).toBeNull();
  });
});

describe("the seven styles and ten sounds as the API lists them (voice-styles.md)", () => {
  const opt = (id: string) => ({ id, label: { en: id, te: "ఉదా" }, hint: { en: "a hint" }, best_for: ["retail", "clinic"], reviewed: false });
  it("tone.options as objects gives the list in the API's order, with words per language and the kinds of business; the older strings give an empty list (the three known styles are drawn)", () => {
    const ids = ["friendly", "respectful", "quick", "professional", "calm_caring", "cheerful", "confident"];
    const got = parseHowSpeaks(RAW({ tone: { value: "calm_caring", source: "saved", pack_default: "friendly", options: ids.map(opt) } }));
    expect(got?.tone.value).toBe("calm_caring");
    expect(got?.tone.options.map((o) => o.id)).toEqual(ids);
    expect(got?.tone.options[3]).toMatchObject({ label: { en: "professional", te: "ఉదా" }, hint: { en: "a hint" }, bestFor: ["retail", "clinic"] });
    expect(parseHowSpeaks(RAW())?.tone.options).toEqual([]);
    expect(parseHowSpeaks(RAW({ tone: { value: "friendly", source: "saved", pack_default: "friendly", options: [opt("friendly"), opt("loud"), { id: "quick" }] } }))?.tone.options.map((o) => o.id)).toEqual(["friendly"]);
  });
  it("background.options keeps up to ten sounds with their preview path (null for Off or anything that is not a preview path)", () => {
    const ids = ["off", "quiet_office", "busy_office", "call_centre", "shop", "market", "showroom", "clinic_reception", "home", "street"];
    const bg = { value: "off", saved: true, options: ids.map((id) => ({ id, label: { en: id }, sample_url: id === "off" ? null : `/v1/background-samples/${id}.mp3` })) };
    const got = parseHowSpeaks(RAW({ background: bg }));
    expect(got?.background?.options.map((o) => o.id)).toEqual(ids);
    expect(got?.background?.options[0].sampleUrl).toBeNull();
    expect(got?.background?.options[4].sampleUrl).toBe("/v1/background-samples/shop.mp3");
    const odd = parseHowSpeaks(RAW({ background: { ...bg, options: [{ id: "shop", label: { en: "Shop" }, sample_url: "https://elsewhere.example/x.mp3" }] } }));
    expect(odd?.background?.options[0].sampleUrl).toBeNull();
  });
});
