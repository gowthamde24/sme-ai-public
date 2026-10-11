import { fill, type Vars } from "@/i18n/fill";

/**
 * The words of a screen (job BK): a flat key -> text record in the person's language, resolved on the server (`wordsFor`, i18n/app-words.ts) and handed down as a `words` prop. `makeT(words)` turns it into
 * the `t("key", { n })` the screens call. No dictionary is imported here, so client components can use it without shipping all four languages. A key that is missing shows as itself (never blank).
 * `words` is optional only so the unit tests can render a part on its own: they set the English fallback once (vitest.setup.ts); the pages always pass the words of the person's language.
 */
export type Words = Readonly<Record<string, string>>;
export type Say = (key: string, vars?: Vars) => string;

let fallback: Words = {};
/** For the unit tests only (vitest.setup.ts): the English words a part uses when it is rendered without `words`. */
export function setFallbackWords(words: Words): void {
  fallback = words;
}

export function makeT(words?: Words): Say {
  const w = words ?? fallback;
  return (key, vars) => fill(w[key] ?? key, vars);
}

/** `t(key)` when the dictionary has it, else `t(fallbackKey)`: for a code the screen does not know yet (a newer API). */
export function labelOr(t: Say, key: string, fallbackKey: string): string {
  const text = t(key);
  return text === key ? t(fallbackKey) : text;
}
