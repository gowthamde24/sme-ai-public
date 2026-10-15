import { fill, type Vars } from "@/i18n/fill";

import type { WorkspacePack } from "./types";

/**
 * Words that depend on what the business sells (jobs CO, CU): a string `some.key` may have a variant `some.key@materials` for a business type that has the module `materials`. The variant replaces the plain string on
 * the screens that call this, so a shared screen (the visit booking, the import, the weekly report) does not say "saree" to someone who sells paver blocks. Nothing here names a business type: it asks for a module, and
 * the variants live in the string store next to the words they replace, in four languages. A variant for a module the business type does not have is ignored, and so is a key the page does not have.
 */
export function withModuleWords<T extends Record<string, string>>(words: T, pack: Pick<WorkspacePack, "modules"> | null | undefined): T {
  if (!pack) return words;
  let out: Record<string, string> | null = null;
  for (const key of Object.keys(words)) {
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const base = key.slice(0, at);
    if (!pack.modules.includes(key.slice(at + 1)) || !(base in words)) continue;
    out ??= { ...words };
    out[base] = words[key];
  }
  return (out ?? words) as T;
}

/**
 * The same variants for a translation FUNCTION (job CU): `t("ask.can.y3")` answers `ask.can.y3@materials` for a business type that has the module `materials`. Used where a screen takes a `t` (Today, the help guides) instead of a
 * table of words. `dict` is the language's own table (it says which variants exist); a key with variables is filled the way the plain one is. Nothing here names a business type.
 */
export function withModuleT<F extends (key: never, vars?: never) => string>(t: F, pack: Pick<WorkspacePack, "modules"> | null | undefined, dict: Readonly<Record<string, string>>): F {
  if (!pack) return t;
  const over = withModuleWords({ ...dict }, pack);
  const changed = new Set(Object.keys(over).filter((k) => over[k] !== dict[k]));
  if (changed.size === 0) return t;
  return (((key: never, vars?: never) => (typeof key === "string" && changed.has(key) ? fill(over[key], vars as Vars | undefined) : t(key, vars))) as unknown) as F;
}
