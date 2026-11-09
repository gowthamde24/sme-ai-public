import { appDict } from "@/i18n/app";
import { LANGS, type Lang } from "@/i18n/lang";

import { MENU, menuItemId } from "../nav";
import { ACTIONS, SETTINGS_PARTS, type PaletteNames } from "./palette";

/** The palette's own words, in the person's language. */
export const PALETTE_WORD_KEYS = ["frame.search", "palette.goto", "palette.recent", "palette.pages", "palette.records", "palette.actions", "palette.ask", "palette.none", "palette.close", "palette.keys", "palette.searching"] as const;

/**
 * Server side: every palette item's words in the four languages of the app, the person's own language first (so the palette shows that one and matches all). Menu rows by their menu id (`m-leads`, `settings`), Settings parts by
 * `settings:<section>`, actions by `action:<id>`. A business type's own word for a row ("Campus visits") is added by the palette from the menu it draws.
 */
export function paletteNames(lang: Lang): { names: PaletteNames; words: Readonly<Record<string, string>> } {
  const order = [lang, ...LANGS.filter((l) => l !== lang)];
  const dicts = order.map((l) => appDict(l) as Readonly<Record<string, string>>);
  const all = (key: string, fallback?: string): string[] => [...new Set([...dicts.map((d) => d[key]).filter((v): v is string => typeof v === "string" && v !== ""), ...(fallback ? [fallback] : [])])];
  const names: Record<string, string[]> = {};
  for (const m of MENU) {
    const id = menuItemId(m);
    names[id] = all(`nav.item.${id}`, m.label);
  }
  names.settings = all("nav.item.settings", "Settings");
  for (const p of SETTINGS_PARTS) names[`settings:${p.section}`] = all(p.key);
  for (const a of ACTIONS) names[`action:${a.id}`] = all(a.key);
  const own = dicts[0];
  return { names, words: Object.fromEntries(PALETTE_WORD_KEYS.map((k) => [k, own[k] ?? k])) };
}
