/** The language a business talks to its customers in (owner, 13 Nov 2026): the business's own, in its script. A business that lists English and another language talks to its customers in the other one, so the first language that is not English wins; English only if that is all it lists. */
export function businessLanguage(languages: readonly string[]): string | null {
  return languages.find((l) => l !== "en") ?? languages[0] ?? null;
}
