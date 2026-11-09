import { withPackWords } from "@/components/v2/app/labels";
import { MENU, menuItemId, type PackFrame } from "@/components/v2/app/nav";
import { ownWords, rowWord } from "@/components/v2/app/nav-words";
import { frameLabels } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { readPackCached } from "@/lib/packs/read";
import { packFrame } from "@/lib/packs/resolve";

/** The menu rows by their table id ("calls", "train"...). */
export type MenuId = (typeof MENU)[number]["id"];

/**
 * A page's H1: its menu row's word, exactly as the side menu, the phone bar and the More sheet show it, in the person's language and with the business type's own word where it has one ("Campus visits", "Programmes") (owner rule, 6 Nov
 * 2026: every menu item opens its own page, whose H1 is the menu's word). The same function the menu uses (nav-words.ts), from the same words (frameLabels + the pack's).
 */
export function menuWord(id: MenuId, lang: Lang, pack: PackFrame | null): string {
  const menu = MENU.find((m) => m.id === id);
  if (!menu) return id;
  const plain = frameLabels(lang);
  return rowWord({ id: menuItemId(menu), label: menu.label, icon: menu.icon, path: "", roles: [], ...(menu.labelOf ? { labelOf: menu.labelOf } : {}) } as Parameters<typeof rowWord>[0], withPackWords(plain, pack), ownWords(pack, plain));
}

/** The same, reading the workspace's business type (cached for the request, as the frame reads it). A pack that cannot be read: the app's own word. */
export async function menuTitle(id: MenuId, lang: Lang, accessToken: string, tenantId: string): Promise<string> {
  const pack = await readPackCached(accessToken, tenantId).catch((e) => {
    if (e instanceof ApiAuthError) throw e;
    return null;
  });
  return menuWord(id, lang, pack ? packFrame(pack, lang) : null);
}
