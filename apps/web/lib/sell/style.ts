import type { SellStyle } from "./types";

/**
 * THE STYLE OF A BUSINESS (planner, 19 Nov): which of the five styles "What you sell" draws follows the business type's pack. C1's `pack.json` has no such field yet, so this closed map is the ONE place that knows it (a pack id that is not here
 * draws Products, the plainest style). C2: when C1 adds `sell_style` to `pack.json` and the pack answer (what-you-sell-web-needs.md, question 1), `styleOfPack` reads it first and this map is deleted.
 * Rule used (mock r3-03/r3-04): Products = textiles, building materials, vehicles, any local business; Services = clinics, gyms, insurance, interiors and solar, travel; Courses = schools, coaching; Properties = real estate; Price lists = wholesale (the Stack19 workspace).
 */
export const PACK_STYLE: Readonly<Record<string, SellStyle>> = {
  textiles: "products",
  construction_materials: "products",
  auto_dealer: "products",
  general_business: "products",
  clinic: "services",
  gym: "services",
  insurance_loans: "services",
  interiors_solar: "services",
  travel: "services",
  education: "courses",
  coaching: "courses",
  real_estate: "properties",
  wholesale_b2b: "pricelist",
};

export function styleOfPack(packId: string | null | undefined, wire?: unknown): SellStyle {
  if (typeof wire === "string" && Object.hasOwn(STYLE_WORDS, wire)) return wire as SellStyle;
  return (packId && Object.hasOwn(PACK_STYLE, packId) ? PACK_STYLE[packId] : null) ?? "products";
}
const STYLE_WORDS: Record<SellStyle, true> = { products: true, services: true, courses: true, properties: true, pricelist: true };

/**
 * Where the shop's REAL data of a style comes from today, by the modules the business type has ON. Only three styles have an API (the saree catalogue, the loaded price list, the programmes); the rest are read from C1's proposed
 * endpoint when it exists (what-you-sell-web-needs.md). `null` = nothing to read yet: the section says so and points to the old page, never a guess.
 */
export type LiveSource = "catalogue" | "price_list" | "programmes" | "what_you_sell";
export function liveSource(style: SellStyle, modules: readonly string[] | null): LiveSource | null {
  const has = (m: string) => (modules ?? []).includes(m);
  if (style === "products") return has("catalogue") && !has("materials") ? "catalogue" : null;
  if (style === "pricelist") return has("quotes") ? "price_list" : null;
  if (style === "courses") return has("programmes") ? "programmes" : null;
  return null;
}

/** The old page of each style (the Catalogue the planner replaced stays reachable: "Open the old page" links to it), relative to the workspace. */
export const OLD_PAGE: Readonly<Record<SellStyle, string | null>> = { products: "/catalogue", services: null, courses: "/programmes", properties: null, pricelist: "/price-list" };
/**
 * The old pages a business is still offered from here, in the order they are shown ("Open the old page", and for a business that quotes, "Open the price list for quotes": the Catalogue row of the menu held both, so neither is lost). A real workspace gets only the pages its business
 * type has (the old pages answer 403 otherwise); test mode (`mock`) offers the style's own, so the link can be seen.
 */
export type OldLink = { path: string; word: "old" | "old_prices" };
export function oldPagesOf(style: SellStyle, modules: readonly string[] | null, mock: boolean): OldLink[] {
  const has = (m: string) => (modules ?? []).includes(m);
  const own = OLD_PAGE[style];
  const out: OldLink[] = [];
  if (own && (mock || (style === "products" ? has("catalogue") || has("materials") : style === "courses" ? has("programmes") : has("quotes")))) out.push({ path: own, word: "old" });
  if (style !== "pricelist" && has("quotes") && !mock) out.push({ path: "/price-list", word: "old_prices" });
  return out;
}
/** The existing paths the three entry buttons reuse where one exists (photos: the catalogue's new-saree page with its photo upload; sheet: the price list's CSV import); null = no path yet (the test mode shows a made-up reading, a real shop is told it is not ready). */
export const ENTRY_PATH: Readonly<Record<SellStyle, { photos: string | null; sheet: string | null }>> = {
  products: { photos: "/catalogue/new", sheet: null },
  services: { photos: null, sheet: null },
  courses: { photos: null, sheet: null },
  properties: { photos: null, sheet: null },
  pricelist: { photos: null, sheet: "/price-list" },
};
