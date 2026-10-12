import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) }),
}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/te" }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));

import LanguageLandingPage, { generateMetadata } from "./page";

beforeEach(() => {
  for (const k of Object.keys(cookieValues)) delete cookieValues[k];
  notFound.mockClear();
});
const params = (lang: string) => ({ params: Promise.resolve({ lang }) });

describe("the public page at an address per language (job BS)", () => {
  for (const lang of ["te", "hi", "kn"] as const) {
    it(`/${lang} is that language whatever the cookie says, and keeps the theme cookie`, async () => {
      cookieValues.sme_lang = "en";
      cookieValues.sme_theme = "dark";
      expect((await LanguageLandingPage(params(lang))).props).toEqual({ lang, theme: "dark" });
    });
    it(`/${lang} has its own title, canonical address, alternates and share picture`, async () => {
      const m = await generateMetadata(params(lang));
      expect(m.alternates?.canonical).toBe(`/${lang}`);
      expect(m.alternates?.languages).toMatchObject({ "en-IN": "/", "te-IN": "/te", "hi-IN": "/hi", "kn-IN": "/kn", "x-default": "/" });
      expect(m.openGraph).toMatchObject({ url: `/${lang}`, images: [{ url: `/og/og-${lang}.png` }] });
      expect(m.robots).toEqual({ index: false, follow: false }); // until the launch switch
    });
  }
  it("any other first segment (English has no segment) is a 404 and has no metadata", async () => {
    for (const bad of ["en", "fr", "TE", "te%2F", "x"]) {
      await expect(LanguageLandingPage(params(bad))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await generateMetadata(params(bad))).toEqual({});
    }
    expect(notFound).toHaveBeenCalledTimes(5);
  });
});
