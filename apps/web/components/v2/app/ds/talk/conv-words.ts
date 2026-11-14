"use client";

import * as React from "react";

import { convLangOf, type ConvLang } from "@/lib/conversation/format-when";
import type { ConvSet } from "@/lib/conversation/word-sets";

import type { Words } from "../../words";

/**
 * The words of the CONVERSATION (owner, 14 Nov 2026): the plan card, its buttons, the status and error lines follow the language of the conversation (the composer's pick, or what the owner speaks), the app's menus keep the app language.
 * The page carries the app language's words; another language's words come from the page's `conv-words` route (a small, cached answer) and are asked for ahead of time (`prefetchConvWords`) so they are there when the bar opens.
 * Until they arrive, or when the route cannot be reached, the app language's words are used: never empty text. ta, ml and mr have no words yet and read in English (the same rule as the voice).
 */
type Entry = { state: "loading" } | { state: "ready"; words: Words } | { state: "failed"; at: number };
/** A failed fetch is tried again after this long (the next time the words are asked for). */
const RETRY_MS = 30_000;
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const keyOf = (base: string, lang: ConvLang, set: ConvSet) => `${base}|${lang}|${set}`;

function load(base: string, lang: ConvLang, set: ConvSet): void {
  const key = keyOf(base, lang, set);
  const had = cache.get(key);
  if (had && !(had.state === "failed" && Date.now() - had.at > RETRY_MS)) return;
  cache.set(key, { state: "loading" });
  void fetch(`${base}/conv-words?lang=${lang}&set=${set}`, { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ words?: unknown }>) : Promise.reject(new Error("no words"))))
    .then((j) => {
      const words = j.words;
      if (typeof words !== "object" || words === null) throw new Error("no words");
      cache.set(key, { state: "ready", words: Object.fromEntries(Object.entries(words).filter((e): e is [string, string] => typeof e[1] === "string")) });
    })
    .catch(() => cache.set(key, { state: "failed", at: Date.now() }))
    .finally(() => listeners.forEach((l) => l()));
}

/** Ask for a language's words ahead of time (the composer's pick changed, the bar is drawn). Nothing happens for the app's own language. */
export function prefetchConvWords(base: string, code: string | null | undefined, appLang: string, sets: readonly ConvSet[] = ["talk", "task"]): void {
  const lang = convLangOf(code);
  if (lang === convLangOf(appLang)) return;
  for (const set of sets) load(base, lang, set);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The words to draw a conversation part with: the conversation language's, laid over the app language's. */
export function useConvWords(o: { base: string; code: string | null | undefined; appLang: string; words: Words; set: ConvSet }): Words {
  const lang = convLangOf(o.code);
  const same = lang === convLangOf(o.appLang);
  const key = keyOf(o.base, lang, o.set);
  const entry = React.useSyncExternalStore(
    subscribe,
    () => (same ? undefined : cache.get(key)),
    () => undefined,
  );
  React.useEffect(() => {
    if (!same) load(o.base, lang, o.set);
  }, [same, o.base, lang, o.set]);
  const loaded = entry?.state === "ready" ? entry.words : null;
  return React.useMemo(() => (loaded ? { ...o.words, ...loaded } : o.words), [loaded, o.words]);
}

/** Test seam: forget what was fetched. */
export function resetConvWords(): void {
  cache.clear();
  listeners.forEach((l) => l());
}
