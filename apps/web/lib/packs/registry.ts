import bundle from "./packs.generated.json";
import type { PackBundle, PackDef, PackLang, PackText } from "./types";

/**
 * The business types, read from the pack files (packages/packs, one folder per business type) through the generated bundle. SERVER ONLY: the bundle holds four languages of every pack, so a client component must not import this file (a test enforces
 * it, as for i18n/app.ts); the server turns what a screen needs into plain props. No pack id is named here or anywhere else in the code: the default pack is the one that says `"default": true`.
 */
const DATA = bundle as unknown as PackBundle;

export const PACKS: readonly PackDef[] = DATA.packs;
/** Every module name a pack may switch on (the schema's list). */
export const MODULES: readonly string[] = DATA.modules;

/** The pack the product was before packs existed: a workspace the API has no pack for yet is drawn with it, and nothing about its screens changes. */
export function defaultPack(): PackDef {
  const found = PACKS.find((p) => p.default);
  if (!found) throw new Error("no default pack: packages/packs needs exactly one pack with \"default\": true");
  return found;
}

/** A pack by id; an id this build does not know (a newer API) gives the default pack, never a crash. */
export function packById(id: string | null | undefined): PackDef {
  return PACKS.find((p) => p.id === id) ?? defaultPack();
}

export function isKnownPack(id: unknown): id is string {
  return typeof id === "string" && PACKS.some((p) => p.id === id);
}

/** The packs a person may pick at sign-up, in order (a pack no real owner has reviewed yet is hidden by its `signup.show`). */
export function signupPacks(): readonly PackDef[] {
  return PACKS.filter((p) => p.signup.show);
}

/** A text in one language, English when the pack has none in that language. */
export function textIn(text: PackText, lang: string): string {
  const l = lang as PackLang;
  return text[l] || text.en;
}
