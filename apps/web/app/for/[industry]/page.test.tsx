import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

import { IndustryPage } from "@/components/v2/site/v9/IndustryPage";
import { siteT } from "@/i18n/site";
import { industryBySlug } from "@/lib/site/industries";

import IndustryRoute from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/for/<industry>", () => {
  it("is a 404 unless INDUSTRY_PAGES=1", async () => {
    await expect(IndustryRoute({ params: Promise.resolve({ industry: "clinics" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("is a 404 for an industry we do not have, even with the flag on", async () => {
    vi.stubEnv("INDUSTRY_PAGES", "1");
    await expect(IndustryRoute({ params: Promise.resolve({ industry: "nothing" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("one h1, three sections, the example call said to be made up, the pricing line and ONE call to action in the hero", () => {
    const { container } = render(<IndustryPage industry={industryBySlug("wholesale")!} t={siteT("en")} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelectorAll("[data-part='industry-sections'] > li")).toHaveLength(3);
    expect(container.querySelector("[data-part='sample-call']")?.textContent).toContain("Made up for this page");
    expect(container.querySelectorAll("[data-part='sample-call'] li")).toHaveLength(4);
    expect(container.querySelector("[data-part='pricing-line']")?.textContent).toContain("₹499");
    expect(container.querySelectorAll("[data-part='hero-cta']")).toHaveLength(1);
    expect(container.querySelector("a[href='/#how']")).not.toBeNull(); // the header's in-page links go to the home page
  });
});
