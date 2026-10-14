import type { PackFrame } from "@/components/v2/app/nav";

import { textIn } from "./registry";
import type { PackDef } from "./types";

/** The words a pack changes, as a flat key -> text record in one language (every key family the schema allows). */
export function packWords(def: PackDef, lang: string): Record<string, string> {
  return Object.fromEntries(Object.entries(def.labels).map(([key, text]) => [key, textIn(text, lang)]));
}

/** `words` with the pack's own words on top: only for keys the page already has (a pack changes words, it does not add screens' text). The same object comes back when nothing changes. */
export function withPackWords<T extends Record<string, string>>(words: T, def: PackDef, lang: string): T {
  const own = packWords(def, lang);
  const hits = Object.keys(own).filter((k) => k in words);
  if (hits.length === 0) return words;
  const out: Record<string, string> = { ...words };
  for (const k of hits) out[k] = own[k];
  return out as T;
}

/** A translator `t(key)` with the pack's words on top (for the screens that take a function). */
export function withPackT<F extends (key: never, vars?: never) => string>(t: F, def: PackDef, lang: string): F {
  const own = packWords(def, lang);
  if (Object.keys(own).length === 0) return t;
  return (((key: never, vars?: never) => (typeof key === "string" && key in own && !vars ? own[key] : t(key, vars))) as unknown) as F;
}

/** What the menu needs (a plain object for the client): the modules that are on, the phone's tabs, and only the `nav.` words (the rest travel with the page that uses them). */
export function packFrame(def: PackDef, modules: readonly string[], lang: string): PackFrame {
  const labels = Object.fromEntries(Object.entries(packWords(def, lang)).filter(([k]) => k.startsWith("nav.")));
  return { id: def.id, name: textIn(def.name, lang), isDefault: def.default, accent: def.signup.accent, modules, bar: def.nav.bar, labels };
}
