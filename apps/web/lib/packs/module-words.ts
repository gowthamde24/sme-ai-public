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
