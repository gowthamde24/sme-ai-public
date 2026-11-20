// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_CLAIMS } from "@/i18n/strings/forbidden";

import { INDUSTRY_PAGES, industryBySlug } from "./industries";
import { OUT, PACKS_DIR, buildIndustryJobs, render } from "../../scripts/industry-jobs.mjs";

const EXPECTED_SLUGS = ["real-estate", "education", "healthcare", "automotive", "retail", "wholesale"] as const;

describe("industry SEO pages data (generated from packages/packs/*/jobs.json)", () => {
  it("is fresh: matches packages/packs/*/jobs.json (`node apps/web/scripts/industry-jobs.mjs`)", () => {
    expect(fs.readFileSync(OUT, "utf8")).toBe(render(buildIndustryJobs(PACKS_DIR)));
  });

  it("defines the 6 industry pages with 3 non-empty jobs each and no forbidden claims", () => {
    expect(INDUSTRY_PAGES.map((p) => p.slug)).toEqual([...EXPECTED_SLUGS]);
    expect(industryBySlug("unknown")).toBeNull();
    for (const p of INDUSTRY_PAGES) {
      expect(p.jobs).toHaveLength(3);
      for (const text of [p.label, p.headline, p.oneLiner, p.metaTitle, p.metaDescription, ...p.jobs.flatMap((j) => [j.title, j.benefit, j.ask])]) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{[a-z_]+\}/);
        expect(text).not.toMatch(/₹/);
        for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(text), `${p.slug} has ${label}: ${text}`).toBe(false);
      }
    }
  });
});
