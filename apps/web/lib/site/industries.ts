import data from "./industry-pages.json";

/**
 * The industry pages (`/for/<industry>`, flag INDUSTRY_PAGES): one honest headline, three plain sections, a sample call and the pricing line. English only until the Telugu, Hindi and Kannada versions are reviewed.
 * The words and the business types live in industry-pages.json (data, not code); `pack` names the business type whose sample call the page shows (the app's `vc.cv.<pack>.friendly`, copied into `call`: the site never imports the app's dictionary).
 */
export type IndustryPageSpec = {
  slug: string;
  pack: string;
  label: string;
  headline: string;
  sub: string;
  sections: readonly { title: string; text: string }[];
  /** The made-up example call: four turns, the caller first (copied from the app's sample call of this business type: lib/site/industries.test.ts keeps the two in step). */
  call: readonly string[];
  metaTitle: string;
  metaDescription: string;
};

const DATA = data as unknown as { pricingLine: string; industries: readonly IndustryPageSpec[] };

export const INDUSTRY_PAGES: readonly IndustryPageSpec[] = DATA.industries;
export const INDUSTRY_PRICING_LINE: string = DATA.pricingLine;

export function industryBySlug(slug: string): IndustryPageSpec | null {
  return INDUSTRY_PAGES.find((p) => p.slug === slug) ?? null;
}
