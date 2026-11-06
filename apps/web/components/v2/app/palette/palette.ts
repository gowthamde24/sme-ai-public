/**
 * The command palette's items, as data (owner, 6 Nov 2026: ⌘K is a real command palette, not a jump to the assistant). Pure: no React, no request; the client palette and its tests use it.
 *
 * - Pages: every menu row the person is offered (the same table and routes as the side menu), the Settings parts (Members, Plan & usage ...).
 * - Actions: Add a lead, Upload a file, Find new customers, Change calling hours, Train how it talks, Top up, each only where its page exists for this person.
 * - Records: from the API's search (C1's GET /search), not here.
 * - Always last: "Ask the assistant: <text>", the one item that goes to the assistant.
 * A label matches in every language of the app and in English (`names`: the words of each language, the person's own first), whatever the case, the spaces or the punctuation.
 */
export type PaletteKind = "page" | "action" | "record" | "ask" | "recent";
export type PaletteItem = { id: string; kind: PaletteKind; label: string; names: readonly string[]; href: string; sub?: string };
/** Each item's words in the four languages of the app (the person's own first), built by the server (names.ts). */
export type PaletteNames = Readonly<Record<string, readonly string[]>>;

export const SETTINGS_PARTS = [
  { section: "business", key: "settings.tab.business" },
  { section: "profile", key: "settings.tab.profile" },
  { section: "plan", key: "plan.tab", admins: true },
  { section: "members", key: "settings.tab.members" },
  { section: "data", key: "settings.tab.data" },
  { section: "language", key: "settings.tab.language" },
  { section: "security", key: "settings.tab.security" },
  { section: "privacy", key: "settings.tab.privacy" },
] as const;

/** The actions: where each goes, and the menu row whose presence means the person may do it (null: any member). */
export const ACTIONS = [
  { id: "add_lead", key: "palette.act.add_lead", path: "/import", needs: "m-leads", admins: false },
  { id: "upload", key: "palette.act.upload", path: "/talk?file=1", needs: "m-assistant", admins: false },
  { id: "find", key: "palette.act.find", path: "/retailers", needs: "m-find", admins: false },
  { id: "hours", key: "palette.act.hours", path: "/settings?section=assistant", needs: "m-train", admins: false },
  { id: "train", key: "palette.act.train", path: "/ai-team/training", needs: "m-train", admins: false },
  { id: "topup", key: "palette.act.topup", path: "/settings?section=plan", needs: null, admins: true },
] as const;

/** Case, spaces and punctuation do not matter; Indic letters keep their marks (NFC), so Telugu typed with a different keyboard still matches. */
export const fold = (s: string): string => s.normalize("NFC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** The items that match what is typed (every word of the query in any of the item's names), the best first: a name that starts with it, then one that holds it. Empty query: none (the palette shows Go to and Recent). */
export function matchItems(query: string, items: readonly PaletteItem[]): PaletteItem[] {
  const q = fold(query);
  if (q === "") return [];
  const scored: [number, PaletteItem][] = [];
  for (const it of items) {
    let best = -1;
    for (const n of it.names) {
      const f = fold(n);
      if (f.startsWith(q)) best = Math.max(best, 2);
      else if (f.includes(q)) best = Math.max(best, 1);
    }
    if (best >= 0) scored.push([best, it]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, it]) => it);
}

/** A record of the API's search, as the palette opens it (routed by kind and id, never by an address the API wrote). */
export function recordHref(base: string, kind: string, id: string): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  switch (kind) {
    case "lead":
      return `${base}/leads/${id}`;
    case "customer":
      return `${base}/companies/${id}`;
    case "order":
      return `${base}/orders/${id}`;
    case "quote":
      return `${base}/quotes/${id}`;
    case "student":
      return `${base}/students/${id}`;
    default:
      return null;
  }
}

/** The pages the person opened last (per person and workspace, in this browser), newest first, at most five, never the same address twice. */
export const RECENT_MAX = 5;
export function addRecent(list: readonly { href: string; label: string }[], entry: { href: string; label: string }): { href: string; label: string }[] {
  return [entry, ...list.filter((e) => e.href !== entry.href)].slice(0, RECENT_MAX);
}
export function parseRecent(raw: string | null): { href: string; label: string }[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is { href: string; label: string } => typeof e === "object" && e !== null && typeof (e as { href?: unknown }).href === "string" && (e as { href: string }).href.startsWith("/app/") && typeof (e as { label?: unknown }).label === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
