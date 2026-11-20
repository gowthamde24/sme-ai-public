import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let requestHost: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (name: string) => (name === "host" ? requestHost : null) }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/for/real-estate",
}));
vi.mock("@/design/fonts", () => ({
  v2FontClassName: () => "font-vars",
  teluguFontVariable: "te-font",
  teluguDemoFontVariable: "te-font-demo",
}));
vi.mock("@/components/v2/site/LazyIslands", async () => ({
  PaverCalculator: (await import("@/components/v2/site/PaverCalculator")).PaverCalculator,
  ContactForm: (await import("@/components/v2/site/ContactForm")).ContactForm,
  WaitlistForm: (await import("@/components/v2/site/WaitlistForm")).WaitlistForm,
  RadarFinder: (await import("@/components/v2/site/home2/RadarFinder")).RadarFinder,
  LeakCalc: (await import("@/components/v2/site/home2/LeakCalc")).LeakCalc,
}));

import { FORBIDDEN_CLAIMS } from "@/i18n/strings/forbidden";
import { INDUSTRY_PAGES } from "@/lib/site/industries";
import { htmlText } from "@/test/html-text";

import sitemap from "../../sitemap";
import IndustrySeoRoute, { generateMetadata } from "./page";

const props = (industry: string) => ({ params: Promise.resolve({ industry }) });

afterEach(() => {
  requestHost = null;
  vi.unstubAllEnvs();
});

describe("/for/[industry] SEO pages behind INDUSTRY_PAGES=1", () => {
  it("returns 404 and empty metadata when INDUSTRY_PAGES is off (default)", async () => {
    for (const p of INDUSTRY_PAGES) {
      await expect(IndustrySeoRoute(props(p.slug))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await generateMetadata(props(p.slug))).toEqual({});
    }
  });

  it("returns 404 for unknown industry slugs even when the flag is on", async () => {
    vi.stubEnv("INDUSTRY_PAGES", "1");
    await expect(IndustrySeoRoute(props("unknown-vertical"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(props("unknown-vertical"))).toEqual({});
  });

  it.each(INDUSTRY_PAGES)("renders /for/$slug when INDUSTRY_PAGES=1 with hero, phone demo, 3 jobs, plans and final CTA", async (page) => {
    vi.stubEnv("INDUSTRY_PAGES", "1");
    const html = renderToStaticMarkup(await IndustrySeoRoute(props(page.slug)));
    const text = htmlText(html);

    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(text).toContain(page.headline);
    expect(text).toContain(page.oneLiner);
    expect(html).toContain('data-part="chat-stack"');
    expect(html).toContain('data-part="industry-jobs"');
    for (const job of page.jobs) {
      expect(html).toContain(`data-job="${job.id}"`);
      expect(text).toContain(job.title);
      expect(text).toContain(job.benefit);
      expect(text).toContain(job.ask);
    }
    expect(text).toContain("Pay as you go");
    expect(text).toContain("Pro");
    expect(text).toContain("Business");
    expect(text).not.toMatch(/\byearly\b|\bannual(ly)?\b/i);
    expect(text).not.toMatch(/\{[a-z_]+\}/);
    const claimText = text.replace(/\b18\s?%\s*GST\b/gi, "");
    for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(claimText), `${page.slug} has ${label}`).toBe(false);

    const meta = await generateMetadata(props(page.slug));
    expect(meta.title).toBe(page.metaTitle);
    expect(meta.alternates?.canonical).toBe(`/for/${page.slug}`);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("adds /for/<industry> URLs to sitemap only when INDUSTRY_PAGES=1 and the site is live", async () => {
    vi.stubEnv("SITE_MODE", "website");
    requestHost = "stack19.com";
    const offUrls = (await sitemap()).map((e) => e.url);
    expect(offUrls.some((u) => u.includes("/for/"))).toBe(false);

    vi.stubEnv("INDUSTRY_PAGES", "1");
    const onUrls = (await sitemap()).map((e) => e.url);
    for (const p of INDUSTRY_PAGES) expect(onUrls).toContain(`https://stack19.com/for/${p.slug}`);
  });
});
