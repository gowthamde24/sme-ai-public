import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) }),
}));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

import LandingPage, { generateMetadata } from "./page";

beforeEach(() => {
  for (const k of Object.keys(cookieValues)) delete cookieValues[k];
});

describe("/landing route", () => {
  it("is English with no explicit theme when there is no cookie", async () => {
    const el = await LandingPage();
    expect(el.props).toEqual({ lang: "en", theme: undefined });
  });
  it("reads the language and theme from the two functional cookies", async () => {
    cookieValues.sme_lang = "te";
    cookieValues.sme_theme = "dark";
    expect((await LandingPage()).props).toEqual({ lang: "te", theme: "dark" });
  });
  it("ignores any cookie value outside the allow-list", async () => {
    cookieValues.sme_lang = "fr; Path=/";
    cookieValues.sme_theme = "<script>";
    expect((await LandingPage()).props).toEqual({ lang: "en", theme: undefined });
  });
  it("sets a localized plain title and description, noindex until launch, a share picture with the owl, and no JSON-LD", async () => {
    cookieValues.sme_lang = "hi";
    const m = await generateMetadata();
    expect(String(m.title)).toMatch(/[ऀ-ॿ]/);
    expect(String(m.title)).not.toContain("⁠");
    expect(String(m.title)).toContain("Sme-AI (working name)");
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.openGraph).toMatchObject({ images: [{ url: "/og/og-hi.png", width: 1200, height: 630 }] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/og/og-hi.png"] });
    expect(m.alternates?.canonical).toBe("/");
    expect(Object.keys(m.alternates?.languages ?? {})).toEqual(["en-IN", "te-IN", "hi-IN", "kn-IN", "x-default"]);
    expect(JSON.stringify(m)).not.toMatch(/ld\+json|schema\.org|example\.invalid/);
    expect(String(m.description)).not.toContain("⁠");
  });
  it("the English description keeps the honest promise: money talk waits for the owner's OK (sign-up is open, so no invitation-only line)", async () => {
    const m = await generateMetadata();
    expect(String(m.description)).toMatch(/waits for your OK/i);
    expect(String(m.description)).not.toMatch(/invitation/i);
  });
});
