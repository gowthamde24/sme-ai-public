import data from "./industry-jobs.generated.json";

export type IndustryJob = {
  id: string;
  kind: string;
  title: string;
  benefit: string;
  ask: string;
};

export type IndustryPageSpec = {
  slug: string;
  label: string;
  headline: string;
  oneLiner: string;
  metaTitle: string;
  metaDescription: string;
  jobs: readonly IndustryJob[];
};

const DATA = data as unknown as { industries: readonly IndustryPageSpec[] };

export const INDUSTRY_PAGES: readonly IndustryPageSpec[] = DATA.industries;

export function industryBySlug(slug: string): IndustryPageSpec | null {
  return INDUSTRY_PAGES.find((p) => p.slug === slug) ?? null;
}
