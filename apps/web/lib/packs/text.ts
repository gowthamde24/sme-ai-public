import type { Words } from "./types";

/** A text in one language, English when there is none in that language (a pack may be partly translated). */
export function textIn(words: Words | undefined, lang: string): string {
  if (!words) return "";
  return words[lang] || words.en || "";
}

/** One pack word (`nav.item.quotes`) in a language: the language's own, else English, else undefined. */
export function labelIn(labels: Readonly<Record<string, Readonly<Record<string, string>>>>, key: string, lang: string): string | undefined {
  return labels[lang]?.[key] || labels.en?.[key] || undefined;
}
