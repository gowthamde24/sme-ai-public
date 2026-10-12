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

let warned = false;

export function makeT(words?: Words): Say {
  if (words === undefined && !warned && Object.keys(fallback).length === 0) {
    // a part was drawn without the words of its page: the person would see raw keys. Said once in the server log so a slip is found, not shipped.
    warned = true;
    console.error("makeT() was called without words and no fallback is set: strings will show as their keys");
  }
  const w = words ?? fallback;
  return (key, vars) => fill(w[key] ?? key, vars);
}

/** The dictionary key of a sentence that lives in a table pinned to the API (the English stays where it is; its words are looked up by this key): `<prefix>.<8 hex digits of FNV-1a over the English>`. */
export function textKey(prefix: string, english: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < english.length; i++) {
    h ^= english.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}.${h.toString(16).padStart(8, "0")}`;
}

/** The words for such a sentence in the person's language, or the English itself when the dictionary has none (a newer sentence of the API is shown, never a raw key). */
export function sayText(t: Say, prefix: string, english: string): string {
  const key = textKey(prefix, english);
  const text = t(key);
  return text === key ? english : text;
}

/** `t(key)` when the dictionary has it, else `t(fallbackKey)`: for a code the screen does not know yet (a newer API). */
export function labelOr(t: Say, key: string, fallbackKey: string): string {
  const text = t(key);
  return text === key ? t(fallbackKey) : text;
}
