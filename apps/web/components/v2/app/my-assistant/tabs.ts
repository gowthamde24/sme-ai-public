import type { Missing, Part } from "@/lib/assistant-status/types";

/** The five tabs of My assistant (owner, 13 Nov 2026), in the order the owner reads them. `knowledge` is the one that opens without a `?tab=`. */
export const TABS = ["knowledge", "voice", "rules", "practice", "golive"] as const;
export type Tab = (typeof TABS)[number];

/** The tab a `?tab=` asks for; anything else is the first. */
export const tabOf = (v: string | string[] | undefined): Tab => {
  const one = Array.isArray(v) ? v[0] : v;
  return (TABS as readonly string[]).includes(one ?? "") ? (one as Tab) : "knowledge";
};

/** The status says "using defaults" for these parts; a tab shows "Using defaults" while its part is one of them. Practice and Go live have nothing to change, so they never show it. */
export const PART_OF_TAB: Partial<Record<Tab, Part>> = { knowledge: "knowledge", voice: "voice", rules: "rules" };
export const tabUsesDefaults = (tab: Tab, usingDefaults: readonly Part[]): boolean => {
  const part = PART_OF_TAB[tab];
  return part !== undefined && usingDefaults.includes(part);
};

/** The address of a tab; the first has none. */
export const tabHref = (base: string, tab: Tab): string => `${base}/my-assistant${tab === "knowledge" ? "" : `?tab=${tab}`}`;

/** Where to fix what is missing: the business name is in Settings > Business, the phone number on the Phone numbers page. */
export const fixHref = (base: string, m: Missing): string => (m === "business_name" ? `${base}/settings?section=business` : `${base}/phone-number`);
