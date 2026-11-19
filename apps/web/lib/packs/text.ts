import { reviewedOnly } from "@/i18n/strings";

import { reviewedPackLabels } from "./reviewed-labels";

import type { Words } from "./types";

/** A text in one language, English when there is none in that language (a pack may be partly translated). */
export function textIn(words: Words | undefined, lang: string): string {
  if (!words) return "";
  if (lang !== "en" && reviewedOnly()) return words.en || ""; // (reviewed-only mode: the pack file's own Telugu is not reviewed)
  return words[lang] || words.en || "";
}

/** One pack word (`nav.item.quotes`) in a language: the language's own, else English, else undefined. */
export function labelIn(labels: Readonly<Record<string, Readonly<Record<string, string>>>>, key: string, lang: string): string | undefined {
  if (lang !== "en" && reviewedOnly()) return (labels[lang]?.[key] ? reviewedPackLabels(lang)[key] : undefined) || labels.en?.[key] || undefined;
  return labels[lang]?.[key] || labels.en?.[key] || undefined;
}
