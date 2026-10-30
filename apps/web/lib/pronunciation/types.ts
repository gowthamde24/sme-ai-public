import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * The workspace's pronunciation list (job pronunciation-quality): a word as it is WRITTEN and how it SOUNDS, in plain letters the owner can type (Pochampally -> "pochampalli"). It is layered on top of C1's shared lexicon. `language` null = in every language.
 * Closed shapes only: a body that does not fit is refused, never repaired.
 */
export const WORD_MAX = 60;
export const SOUND_MAX = 80;
export const LIST_MAX = 100;
export type Entry = { id: string; word: string; soundsLike: string; language: CallLang | null };
/** A word the business already uses (its name, its town) that the owner may want to teach; `reason` is a closed word. */
export type Suggestion = { word: string; reason: "business_name" | "city" | "product" };
export type PronError = "invalid" | "forbidden" | "full" | "not_available" | "down";
export type PronList = { items: Entry[]; suggestions: Suggestion[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUIDISH = /^[0-9a-f-]{8,40}$/i;
const REASONS = ["business_name", "city", "product"] as const;
const isLang = (v: unknown): v is CallLang => (CALL_LANGS as readonly unknown[]).includes(v);

/** A word or a sound: 1..max characters after trimming, no line breaks, no angle brackets (nothing the voice could read as markup). */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v.length >= 1 && v.length <= max && !/[<>{}]/.test(v) ? v : null;
}

export function parseEntry(json: unknown): Entry | null {
  if (!isRecord(json) || typeof json.id !== "string" || !UUIDISH.test(json.id)) return null;
  const word = cleanText(json.word, WORD_MAX);
  const soundsLike = cleanText(json.sounds_like, SOUND_MAX);
  if (word === null || soundsLike === null) return null;
  if (json.language !== null && json.language !== undefined && !isLang(json.language)) return null;
  return { id: json.id, word, soundsLike, language: json.language ?? null } as Entry;
}

export function parseList(json: unknown): PronList | null {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 500) return null;
  const items: Entry[] = [];
  for (const r of json.items) {
    const e = parseEntry(r);
    if (e === null) return null;
    items.push(e);
  }
  const suggestions: Suggestion[] = [];
  if (Array.isArray(json.suggestions)) {
    for (const s of json.suggestions.slice(0, 50)) {
      const word = isRecord(s) ? cleanText(s.word, WORD_MAX) : null;
      if (word === null || !isRecord(s) || !(REASONS as readonly unknown[]).includes(s.reason)) continue; // a suggestion we cannot read is dropped, not an error
      suggestions.push({ word, reason: s.reason as Suggestion["reason"] });
    }
  }
  return { items, suggestions };
}

/** Words of the business name and its town worth offering (3+ letters, not yet in the list), as suggestions; the API's own suggestions come first and are not repeated. */
export function offerFromBusiness(name: string, city: string | null, have: readonly Entry[], more: readonly Suggestion[]): Suggestion[] {
  const known = new Set([...have.map((e) => e.word.toLowerCase()), ...more.map((s) => s.word.toLowerCase())]);
  const out: Suggestion[] = [...more.filter((s) => !have.some((e) => e.word.toLowerCase() === s.word.toLowerCase()))];
  const add = (text: string, reason: Suggestion["reason"]) => {
    for (const raw of text.split(/[\s,.&/()-]+/)) {
      const w = raw.trim();
      if (w.length < 3 || /^\d+$/.test(w) || known.has(w.toLowerCase())) continue;
      known.add(w.toLowerCase());
      out.push({ word: w, reason });
    }
  };
  add(name, "business_name");
  if (city) add(city, "city");
  return out.slice(0, 8);
}
