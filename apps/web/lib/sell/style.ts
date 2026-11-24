import type { SellStyle } from "./types";

/**
 * THE STYLE OF A BUSINESS (planner, 19 Nov): which of the five styles "What you sell" draws follows the business type's pack. C1's contract 1.1 part 1 (W1, 19 Nov) adds `sell_style` to `pack.json` and to the pack answer (`GET /tenants/{id}/pack`):
 * `styleOfPack` reads that word FIRST. This closed map is the FALLBACK for an API that does not send it yet (and a test fails for a pack that is not in it, so the fallback never rots). The map is C1's confirmed one:
 * Products = textiles, building materials, vehicles, any local business; Services = clinics, gyms (a membership is a priced service), insurance, interiors and solar, travel; Courses = schools, coaching; Properties = real estate; Price lists = wholesale.
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
  // the 41 business types added 29 Nov 2026 (reports/business-type-catalogue.md); C1's `sell_style` in identity.json is read first
  agri_nursery: "products",
  appliance_vehicle_repair: "services",
  arts_music: "courses",
  bakery_sweets: "products",
  car_service: "services",
  catering_tiffin: "products",
  cleaning_pest: "services",
  cloud_kitchen: "products",
  consultants_agencies: "services",
  creators_communities: "services",
  dental: "services",
  diagnostics_lab: "services",
  digital_products: "products",
  electronics: "products",
  event_wedding: "services",
  fashion_tailor: "products",
  finance_agent: "services",
  furniture: "products",
  hardware_paint: "products",
  home_repair: "services",
  hotel_homestay: "products",
  jewellery: "products",
  kirana: "products",
  laundry_dry_cleaning: "services",
  legal_ca: "services",
  ngo_trust: "services",
  online_courses: "courses",
  online_store: "products",
  pharmacy: "products",
  photography: "services",
  physio_rehab: "services",
  preschool: "courses",
  restaurant: "products",
  salon_beauty: "services",
  skills_training: "courses",
  software_saas: "services",
  sports_academy: "courses",
  stationery_gifts: "products",
  vehicle_rental: "products",
  vet_pet: "services",
  yoga_studio: "services",
};

export function styleOfPack(packId: string | null | undefined, wire?: unknown): SellStyle {
  if (typeof wire === "string" && Object.hasOwn(STYLE_WORDS, wire)) return wire as SellStyle;
  return (packId && Object.hasOwn(PACK_STYLE, packId) ? PACK_STYLE[packId] : null) ?? "products";
}
const STYLE_WORDS: Record<SellStyle, true> = { products: true, services: true, courses: true, properties: true, pricelist: true };

/**
 * Where the shop's REAL data of a style comes from, by the modules the business type has ON. PRODUCTS are always the catalogue routes. The other four styles are read from C1's `GET /what-you-sell?style=` (contract 1.1 part 1, W2): this says what is
 * used when that route answers 404 ("not there yet"): the loaded price list and the programmes (the old routes), else nothing (`null`: the section says so and points to the old page, never a guess).
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
