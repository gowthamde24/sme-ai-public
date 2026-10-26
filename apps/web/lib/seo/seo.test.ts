// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_PACKS } from "@/lib/site/packs";
import { allTargets } from "@/lib/site/routes";
import { sitePath } from "@/lib/site/paths";
import { LANDING_LANGS, OG_SIZE, SITE_LIVE, isRouteLang, landingPath, ogImagePath, ogImagePathForSlug } from "./site";

const WEB = path.resolve(import.meta.dirname, "../..");
const pngSize = (rel: string) => {
  const b = readFileSync(path.join(WEB, "public", rel));
  expect(b.subarray(0, 8).toString("hex"), rel).toBe("89504e470d0a1a0a");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

describe("SEO (job BS)", () => {
  it("has a share picture for every language at the size Open Graph asks for", () => {
    for (const l of LANDING_LANGS) expect(pngSize(ogImagePath(l)), l).toEqual(OG_SIZE);
  });
  it("has a share picture for every business type page in every language (a page of its own, with that type's colour)", () => {
    expect(SITE_PACKS.length).toBeGreaterThanOrEqual(3);
    for (const p of SITE_PACKS) for (const l of LANDING_LANGS) expect(pngSize(ogImagePathForSlug(p.slug, l)), `${p.slug} ${l}`).toEqual(OG_SIZE);
  });
  it("English is '/', the others have '/te', '/hi', '/kn'", () => {
    expect(LANDING_LANGS.map(landingPath)).toEqual(["/", "/te", "/hi", "/kn"]);
    expect(["te", "hi", "kn"].every(isRouteLang)).toBe(true);
    expect(isRouteLang("en")).toBe(false);
  });
  it("before launch (the switch is off) robots.txt turns every crawler away and the sitemap is empty", async () => {
    expect(SITE_LIVE).toBe(false);
    expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(await sitemap()).toEqual([]);
  });
});

describe("SEO with the launch switch on", () => {
  it("opens the public pages, keeps the app and the sign-in pages closed, and lists the pages with their language alternates", async () => {
    // the switch is read when the module loads: load robots and sitemap again with it on
    const prev = process.env.NEXT_PUBLIC_SITE_LIVE;
    process.env.NEXT_PUBLIC_SITE_LIVE = "1";
    process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example/"; // where a deployment is served from: it must NOT change the canonical addresses below
    const { vi } = await import("vitest");
    vi.resetModules();
    const live = await import("@/lib/seo/site");
    const r = await (await import("@/app/robots")).default();
    const s = await (await import("@/app/sitemap")).default();
    process.env.NEXT_PUBLIC_SITE_LIVE = prev;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.resetModules();
    expect(live.SITE_LIVE).toBe(true);
    expect(live.SITE_URL).toBe("https://shop.example"); // the sign-in redirect
    expect(live.PUBLIC_URL).toBe("https://stack19.com");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toEqual(expect.arrayContaining(["/", "/te", "/hi", "/kn"]));
    expect(rule.disallow).toEqual(expect.arrayContaining(["/app", "/auth", "/api", "/login", "/signup"]));
    expect(r.sitemap).toBe("https://stack19.com/sitemap.xml");
    expect(r.host).toBe("https://stack19.com");
    expect(rule.allow).toEqual(expect.arrayContaining(["/privacy", "/terms", "/data-deletion"]));
    const urls = s.map((e) => e.url);
    // every page of the site in every language, then the three legal pages
    const expected = allTargets().flatMap((t) => LANDING_LANGS.map((l) => `https://stack19.com${sitePath(l, t) === "/" ? "/" : sitePath(l, t)}`));
    expect(urls).toEqual([...expected, "https://stack19.com/privacy", "https://stack19.com/terms", "https://stack19.com/data-deletion"]);
    expect(urls).toEqual(expect.arrayContaining(["https://stack19.com/pricing", "https://stack19.com/te/pricing", "https://stack19.com/hi/construction", "https://stack19.com/kn/education", "https://stack19.com/textiles"]));
    expect(new Set(urls).size).toBe(urls.length);
    for (const e of s.filter((x) => x.url.includes("/pricing"))) expect(Object.keys(e.alternates?.languages ?? {}).sort()).toEqual(["en-IN", "hi-IN", "kn-IN", "te-IN"]);
    expect(s.find((e) => e.url === "https://stack19.com/te/pricing")?.alternates?.languages).toMatchObject({ "en-IN": "https://stack19.com/pricing", "kn-IN": "https://stack19.com/kn/pricing" });
    expect(s[0].alternates?.languages).toMatchObject({ "te-IN": "https://stack19.com/te", "en-IN": "https://stack19.com/" });
  });
});
