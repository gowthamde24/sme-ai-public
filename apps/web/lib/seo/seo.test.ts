// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { LANDING_LANGS, OG_SIZE, SITE_LIVE, isRouteLang, landingPath, ogImagePath } from "./site";

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
  it("English is '/', the others have '/te', '/hi', '/kn'", () => {
    expect(LANDING_LANGS.map(landingPath)).toEqual(["/", "/te", "/hi", "/kn"]);
    expect(["te", "hi", "kn"].every(isRouteLang)).toBe(true);
    expect(isRouteLang("en")).toBe(false);
  });
  it("before launch (the switch is off) robots.txt turns every crawler away and the sitemap is empty", () => {
    expect(SITE_LIVE).toBe(false);
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(sitemap()).toEqual([]);
  });
});

describe("SEO with the launch switch on", () => {
  it("opens the public pages, keeps the app and the sign-in pages closed, and lists the pages with their language alternates", async () => {
    // the switch is read when the module loads: load robots and sitemap again with it on
    const prev = process.env.NEXT_PUBLIC_SITE_LIVE;
    process.env.NEXT_PUBLIC_SITE_LIVE = "1";
    process.env.NEXT_PUBLIC_SITE_URL = "https://shop.example/";
    const { vi } = await import("vitest");
    vi.resetModules();
    const live = await import("@/lib/seo/site");
    const r = (await import("@/app/robots")).default();
    const s = (await import("@/app/sitemap")).default();
    process.env.NEXT_PUBLIC_SITE_LIVE = prev;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    vi.resetModules();
    expect(live.SITE_LIVE).toBe(true);
    expect(live.SITE_URL).toBe("https://shop.example");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toEqual(expect.arrayContaining(["/", "/te", "/hi", "/kn"]));
    expect(rule.disallow).toEqual(expect.arrayContaining(["/app", "/auth", "/api", "/login", "/signup"]));
    expect(r.sitemap).toBe("https://shop.example/sitemap.xml");
    expect(s.map((e) => e.url)).toEqual(["https://shop.example/", "https://shop.example/te", "https://shop.example/hi", "https://shop.example/kn", "https://shop.example/privacy", "https://shop.example/terms"]);
    expect(s[0].alternates?.languages).toMatchObject({ "te-IN": "https://shop.example/te", "en-IN": "https://shop.example/" });
  });
});
