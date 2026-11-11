import { introduceProblem, introduceToApi, parseIntroduceAs, type IntroduceAs } from "./introduce";

/**
 * "How your assistant speaks" (owner decision 11 Nov 2026; C1's FIXED contract docs/contracts/how-assistant-speaks.md, PR #459: the endpoint `GET/PUT /how-assistant-speaks` is built after it, until then the panel runs on a mock made from the contract). One object for Tone, Words per
 * language (with the Region), and Introduce as. Casual is NOT an option here (the owner's own test call only); Formal is hidden. Pure: no fetch, no React.
 */
export const TONES = ["respectful", "friendly"] as const;
export type SpeakTone = (typeof TONES)[number];
export const STYLES = ["everyday_mixed", "everyday_pure"] as const; // "formal" is not offered; one saved earlier is shown as everyday_pure (the API does this)
export type SpeakStyle = (typeof STYLES)[number];
/** The languages the panel shows Words for (Tamil only for its regions; Malayalam and Marathi are paused, owner 9 Nov). */
export const SPEAK_LANGS = ["te", "kn", "hi", "ta"] as const;
export type SpeakLang = (typeof SPEAK_LANGS)[number];
export const REGIONS: Record<SpeakLang, readonly string[]> = { te: ["neutral", "coastal", "telangana", "rayalaseema"], kn: ["neutral", "bengaluru", "north_karnataka"], ta: ["neutral", "chennai", "kongu"], hi: ["neutral"] };
/** The languages that have a region to choose (more than "neutral"). */
export const REGION_LANGS = ["te", "kn", "ta"] as const;
export type RegionLang = (typeof REGION_LANGS)[number];
export const EXAMPLE_LANGS = ["te", "kn", "hi", "en"] as const;
export type ExampleLang = (typeof EXAMPLE_LANGS)[number];
export type ToneSource = "saved" | "migrated" | "pack_default";
export type LegacyAddress = "plain" | "sir_madam" | "garu" | "ji";

export type LangStyle = { style: SpeakStyle; region: string; saved: boolean; examples: "approved" | "draft" };
export type HowSpeaks = {
  tone: { value: SpeakTone; source: ToneSource; packDefault: SpeakTone };
  words: Record<SpeakLang, LangStyle>;
  introduceAs: IntroduceAs & { ownerName: string | null };
  packDefaults: { tone: SpeakTone };
  legacyAddress: LegacyAddress | null;
  updatedAt: string | null;
};
/** What the Owner changes: any subset (a key left out is not changed). `tone: null` resets to the business type's usual. */
export type SpeaksChange = { tone?: SpeakTone | null; words?: Partial<Record<SpeakLang, { style?: SpeakStyle; region?: string }>>; introduceAs?: IntroduceAs };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const one = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);

/** The API's answer, field by field (an odd answer is null, never a guess). `formal` (a workspace that saved it earlier) is read as everyday_pure, as the contract says. */
export function parseHowSpeaks(raw: unknown): HowSpeaks | null {
  if (!isRec(raw) || !isRec(raw.tone) || !isRec(raw.words) || !isRec(raw.words.languages) || !isRec(raw.introduce_as)) return null;
  const tone = one(TONES, raw.tone.value);
  const packDefault = one(TONES, raw.tone.pack_default);
  const source = one(["saved", "migrated", "pack_default"] as const, raw.tone.source);
  if (!tone || !packDefault || !source) return null;
  const words = {} as Record<SpeakLang, LangStyle>;
  for (const l of SPEAK_LANGS) {
    const e = raw.words.languages[l];
    if (!isRec(e)) return null;
    const style: SpeakStyle = e.style === "everyday_mixed" ? "everyday_mixed" : "everyday_pure";
    const region = typeof e.region === "string" && REGIONS[l].includes(e.region) ? e.region : "neutral";
    words[l] = { style, region, saved: e.saved === true, examples: e.examples === "approved" ? "approved" : "draft" };
  }
  const ia = parseIntroduceAs({ kind: raw.introduce_as.kind, text: raw.introduce_as.text ?? null });
  if (!ia) return null;
  const ownerName = typeof raw.introduce_as.owner_name === "string" && raw.introduce_as.owner_name.trim() !== "" ? raw.introduce_as.owner_name.trim().slice(0, 40) : null;
  const pd = isRec(raw.pack_defaults) ? one(TONES, raw.pack_defaults.tone) : null;
  return {
    tone: { value: tone, source, packDefault },
    words,
    introduceAs: { ...ia, ownerName },
    packDefaults: { tone: pd ?? packDefault },
    legacyAddress: one(["plain", "sir_madam", "garu", "ji"] as const, raw.legacy_address),
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

/** The contract's migration of the old "How to address customers": plain (never chosen) = the business type's usual; sir_madam, garu and ji = Respectful. Used by the mock; the API does it for real. */
export const toneFromLegacy = (address: LegacyAddress | null, packDefault: SpeakTone): SpeakTone => (address === "sir_madam" || address === "garu" || address === "ji" ? "respectful" : packDefault);

export type SpeaksProblem = "tone" | "language" | "style" | "region" | "introduce" | "empty";
/** The browser's change, checked again on the server with the contract's rules; the problem is a closed word, never the API's text. */
export function speaksProblem(c: unknown): SpeaksProblem | null {
  if (!isRec(c)) return "empty";
  const keys = Object.keys(c);
  if (keys.length === 0 || keys.some((k) => !["tone", "words", "introduceAs"].includes(k))) return "empty";
  if (c.tone !== undefined && c.tone !== null && one(TONES, c.tone) === null) return "tone";
  if (c.words !== undefined) {
    if (!isRec(c.words) || Object.keys(c.words).length === 0) return "language";
    for (const [l, v] of Object.entries(c.words)) {
      if (!(SPEAK_LANGS as readonly string[]).includes(l) || !isRec(v) || Object.keys(v).length === 0 || Object.keys(v).some((k) => k !== "style" && k !== "region")) return "language";
      if (v.style !== undefined && one(STYLES, v.style) === null) return "style";
      if (v.region !== undefined && !(typeof v.region === "string" && REGIONS[l as SpeakLang].includes(v.region))) return "region";
    }
  }
  if (c.introduceAs !== undefined) {
    const ia = parseIntroduceAs(c.introduceAs);
    if (!ia || introduceProblem(ia) !== null) return "introduce";
  }
  return null;
}

/** The PUT body (the contract's own words). */
export function speaksToApi(c: SpeaksChange): Record<string, unknown> {
  return {
    ...(c.tone !== undefined ? { tone: c.tone } : {}),
    ...(c.words ? { words: c.words } : {}),
    ...(c.introduceAs ? { introduce_as: introduceToApi(c.introduceAs) } : {}),
  };
}

export const regionKey = (lang: RegionLang, region: string): string => (region === "neutral" ? "sp.region.neutral" : `sp.region.${lang}.${region}`);
