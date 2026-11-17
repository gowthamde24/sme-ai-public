import { GOALS, type Goal } from "./types";

/**
 * The goals a business type offers in a standing rule (owner, 17 Nov: the goal list was every goal of every business, "Book a test drive" for a saree shop). Each business type's pack has ONE lead goal of its own
 * (packages/packs/<pack>/leads.json); the three general ones are for everybody. A pack not named here (or no pack) gets every goal, as before. The rule being changed keeps its own goal (the form adds it).
 */
const COMMON: readonly Goal[] = ["general", "qualify", "callback"];
const OWN: Readonly<Record<string, readonly Goal[]>> = {
  textiles: ["site_visit", "quote"], // a shop: visit the store, or a quote for a bulk order
  auto_dealer: ["test_drive"],
  clinic: ["appointment"],
  coaching: ["counselling"],
  education: ["counselling"],
  general_business: ["appointment"],
  gym: ["trial"],
  insurance_loans: ["appointment"],
  interiors_solar: ["site_measurement", "site_visit"],
  real_estate: ["site_visit"],
  travel: ["quote"],
  wholesale_b2b: ["quote"],
  construction_materials: ["quote", "site_visit"],
};

export function goalsForPack(packId: string | null | undefined): readonly Goal[] | null {
  const own = packId ? OWN[packId] : undefined;
  if (!own) return null;
  return GOALS.filter((g) => COMMON.includes(g) || own.includes(g));
}

/** The sample business name C1's previews are filled with (Meta's own sample for the templates). */
const SAMPLE_BUSINESS = "Sri Lakshmi Silks";

/** A template preview with the REAL business name where the sample one stood (owner, 17 Nov: the preview said "Sri Lakshmi Silks" to a shop called something else). A demo workspace's "(demo)" is not part of what a customer would read. */
export function withBusinessName(preview: string, businessName: string | null | undefined): string {
  const name = (businessName ?? "").replace(/\s*\(demo\)\s*$/i, "").trim();
  return name ? preview.split(SAMPLE_BUSINESS).join(name) : preview;
}
