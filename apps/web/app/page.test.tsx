import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) }),
}));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { renderToStaticMarkup } from "react-dom/server";

import Landing, { generateMetadata as landingMetadata } from "@/app/landing/page";
import Home, { generateMetadata } from "./page";

beforeEach(() => {
  for (const k of Object.keys(cookieValues)) delete cookieValues[k];
});

describe('"/" is the landing page', () => {
  it("is the same page and the same metadata as /landing (one implementation)", () => {
    expect(Home).toBe(Landing);
    expect(generateMetadata).toBe(landingMetadata);
  });

  it("renders the landing: one h1, the product name, a Sign in link to /login, and none of the old placeholder", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/Sme-.AI \(working name\)/);
    expect(html).toMatch(/<a[^>]*href="\/login"/);
    expect(html).not.toMatch(/Foundation build|No business features yet|T002/);
  });

  it("follows the language cookie, ignores a value outside the allow-list", async () => {
    cookieValues.sme_lang = "kn";
    expect((await Home()).props).toEqual({ lang: "kn", theme: undefined });
    cookieValues.sme_lang = "fr";
    expect((await Home()).props).toEqual({ lang: "en", theme: undefined });
  });

  it("keeps the pre-launch rules: noindex, no og:image, no JSON-LD", async () => {
    const m = await generateMetadata();
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.openGraph).not.toHaveProperty("images");
    expect(JSON.stringify(m)).not.toMatch(/ld\+json|schema\.org/);
  });
});
