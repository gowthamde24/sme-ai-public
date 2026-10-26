import { enabledFeatures } from "@/lib/screens/features";
import type { PackFrame } from "@/components/v2/app/nav";

import { textIn } from "./text";
import type { WorkspacePack } from "./types";

/** The words a pack changes, as a flat key -> text record in one language (the pack's own keys; English fills any key the language lacks). */
export function packWords(pack: Pick<WorkspacePack, "labels">, lang: string): Record<string, string> {
  const out: Record<string, string> = { ...pack.labels.en };
  for (const [key, text] of Object.entries(pack.labels[lang] ?? {})) out[key] = text;
  return out;
}

/** `words` with the pack's own words on top: only for keys the page already has (a pack changes words, it does not add screens' text). The same object comes back when nothing changes. */
export function withPackWords<T extends Record<string, string>>(words: T, pack: Pick<WorkspacePack, "labels">, lang: string): T {
  const own = packWords(pack, lang);
  const hits = Object.keys(own).filter((k) => k in words && own[k] !== words[k]);
  if (hits.length === 0) return words;
  const out: Record<string, string> = { ...words };
  for (const k of hits) out[k] = own[k];
  return out as T;
}

/** A translator `t(key)` with the pack's words on top (for the screens that take a function). */
export function withPackT<F extends (key: never, vars?: never) => string>(t: F, pack: Pick<WorkspacePack, "labels">, lang: string): F {
  const own = packWords(pack, lang);
  if (Object.keys(own).length === 0) return t;
  return (((key: never, vars?: never) => (typeof key === "string" && key in own && !vars ? own[key] : t(key, vars))) as unknown) as F;
}

/**
 * The layout of the phone's bottom bar of a business type (job CU): a PACK SETTING, read from the pack's `core_tab`. A pack whose core tab is the quotes keeps the bar the product always had (the saree shop: Today, Leads, Quotes, Visits,
 * Office); a pack whose core tab is another one (Orders & deliveries, Fees) gets the blueprint's bar: Today, Inbox, its core tab, Contacts, then More. The pack files do not carry a bar field of their own yet (a new field would change
 * their hash, which the database copies: a pack-version job); until then the core tab decides. No business type is named here.
 */
export function phoneBar(pack: Pick<WorkspacePack, "coreTab">): "classic" | "core" {
  return pack.coreTab === "quotes" ? "classic" : "core";
}

/** What the menu needs (a plain object for the client): the modules that are on, the core tab and only the `nav.` words and the core tab's word (the rest travel with the page that uses them). */
export function packFrame(pack: WorkspacePack, lang: string): PackFrame {
  const labels = Object.fromEntries(Object.entries(packWords(pack, lang)).filter(([k]) => k.startsWith("nav.") || k === "pack.core_tab"));
  return { name: textIn(pack.names, lang), accent: pack.accent, validated: pack.validated, coreTab: pack.coreTab, modules: pack.modules, labels, bar: phoneBar(pack), features: enabledFeatures() };
}
