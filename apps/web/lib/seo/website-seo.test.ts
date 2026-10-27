// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ value: "stack19.com" as string | null, forwarded: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => (n === "host" ? host.value : n === "x-forwarded-host" ? host.forwarded : null) }) }));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isServed } from "@/lib/site/mode";
import { allTargets } from "@/lib/site/routes";
import { sitePath } from "@/lib/site/paths";

import { LANDING_LANGS } from "./site";
import { siteMetadata } from "./site-metadata";
import { legalMetadata } from "@/lib/legal/page-metadata";
import { requestIndexable } from "./index-rule";

beforeEach(() => {
  host.value = "stack19.com";
  host.forwarded = null;
  vi.stubEnv("SITE_MODE", "website");
});
afterEach(() => vi.unstubAllEnvs());

describe("search engines and website mode (job DQ)", () => {
  it("on stack19.com robots.txt is open to the public pages, closed to the app, and names the sitemap", async () => {
    const r = await robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toEqual(expect.arrayContaining(["/", "/te", "/hi", "/kn", "/privacy", "/terms", "/data-deletion"]));
    expect(rule.disallow).toEqual(expect.arrayContaining(["/app", "/auth", "/api", "/login", "/signup", "/setup", "/landing", "/opening-soon"]));
    expect(r.sitemap).toBe("https://stack19.com/sitemap.xml");
  });

  it("the forwarded host wins over the host the proxy in front gave (Cloud Run renames it)", async () => {
    host.value = "sme-web-abc.a.run.app";
    host.forwarded = "www.stack19.com";
    expect(await requestIndexable()).toBe(true);
    host.forwarded = "sme-web-abc.a.run.app";
    expect(await requestIndexable()).toBe(false);
  });

  it("staging (any other host) stays closed to every crawler and has an empty sitemap, even in website mode", async () => {
    host.value = "sme-web-abc.a.run.app";
    expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(await sitemap()).toEqual([]);
    expect(siteMetadata("en", { kind: "home" }, "/", await requestIndexable()).robots).toEqual({ index: false, follow: false });
  });

  it("without website mode even stack19.com is closed (the launch switch is the only other way)", async () => {
    vi.unstubAllEnvs();
    expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(await sitemap()).toEqual([]);
  });

  it("the sitemap lists only the pages the website serves, in four languages with alternates, then the legal pages", async () => {
    const s = await sitemap();
    const urls = s.map((e) => e.url);
    const expected = allTargets().filter((t) => isServed(t)).flatMap((t) => LANDING_LANGS.map((l) => `https://stack19.com${sitePath(l, t)}`));
    expect(urls).toEqual([...expected, "https://stack19.com/privacy", "https://stack19.com/terms", "https://stack19.com/data-deletion"]);
    for (const gone of ["how-it-works", "security", "help"]) expect(urls.filter((u) => u.endsWith(`/${gone}`))).toEqual([]);
    expect(urls).toEqual(expect.arrayContaining(["https://stack19.com/pricing", "https://stack19.com/contact", "https://stack19.com/hi/construction", "https://stack19.com/kn/education", "https://stack19.com/textiles"]));
    expect(new Set(urls).size).toBe(urls.length);
    for (const e of s.filter((x) => x.url.endsWith("/contact") || x.url.endsWith("/te/contact"))) expect(Object.keys(e.alternates?.languages ?? {}).sort()).toEqual(["en-IN", "hi-IN", "kn-IN", "te-IN"]);
  });

  it("every page head: canonical on stack19.com, the four hreflang alternates and x-default, index allowed, the share picture", () => {
    for (const lang of LANDING_LANGS)
      for (const t of allTargets().filter((x) => isServed(x))) {
        const m = siteMetadata(lang, t, undefined, true);
        expect(m.robots).toEqual({ index: true, follow: true });
        expect(m.alternates?.canonical).toBe(sitePath(lang, t));
        expect(Object.keys(m.alternates?.languages ?? {}).sort()).toEqual(["en-IN", "hi-IN", "kn-IN", "te-IN", "x-default"]);
        expect(typeof m.title === "string" && m.title.length > 3).toBe(true);
        expect((m.description ?? "").length).toBeGreaterThan(20);
        expect(m.openGraph?.images).toEqual([expect.objectContaining({ width: 1200, height: 630 })]);
      }
    expect(legalMetadata("/privacy", "Privacy Policy", "x", true).robots).toEqual({ index: true, follow: true });
  });
});
