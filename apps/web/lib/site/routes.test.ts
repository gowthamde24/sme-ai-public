// @vitest-environment node
import { describe, expect, it } from "vitest";

import { HELP_ARTICLES } from "@/lib/public/data";

import { SITE_PACKS } from "./packs";
import { sitePath, SITE_PAGES } from "./paths";
import { allTargets, resolveSite } from "./routes";

describe("the addresses of the public site", () => {
  it("English has no prefix; Telugu, Hindi, Kannada and Tamil have one", () => {
    expect(sitePath("en", { kind: "home" })).toBe("/");
    expect(sitePath("te", { kind: "home" })).toBe("/te");
    expect(sitePath("en", { kind: "page", page: "pricing" })).toBe("/pricing");
    expect(sitePath("hi", { kind: "page", page: "how-it-works" })).toBe("/hi/how-it-works");
    expect(sitePath("kn", { kind: "pack", slug: "anything" })).toBe("/kn/anything");
    expect(sitePath("ta", { kind: "home" })).toBe("/ta");
    expect(sitePath("ta", { kind: "page", page: "pricing" })).toBe("/ta/pricing");
  });
  it("reads an address back as a language and a page", () => {
    expect(resolveSite([])).toEqual({ lang: "en", target: { kind: "home" } });
    expect(resolveSite(["te"])).toEqual({ lang: "te", target: { kind: "home" } });
    expect(resolveSite(["pricing"])).toEqual({ lang: "en", target: { kind: "page", page: "pricing" } });
    expect(resolveSite(["kn", "security"])).toEqual({ lang: "kn", target: { kind: "page", page: "security" } });
    expect(resolveSite(["ta"])).toEqual({ lang: "ta", target: { kind: "home" } });
    expect(resolveSite(["ta", "pricing"])).toEqual({ lang: "ta", target: { kind: "page", page: "pricing" } });
    const slug = SITE_PACKS[0].slug;
    expect(resolveSite([slug])).toEqual({ lang: "en", target: { kind: "pack", slug } });
    expect(resolveSite(["hi", slug])).toEqual({ lang: "hi", target: { kind: "pack", slug } });
  });
  it("answers null (a 404) for anything else: an unknown page or language, 'en' as a prefix, a third segment, a page after an English page", () => {
    for (const bad of [["nope"], ["fr"], ["en"], ["en", "pricing"], ["te", "nope"], ["te", "pricing", "x"], ["pricing", "te"], ["te", "te"], ["ta", "ta"], ["ml"], [""]]) expect(resolveSite(bad), JSON.stringify(bad)).toBeNull();
  });
  it("lists every page once: the home page, the fixed pages and one for each business type that has a landing file", () => {
    const all = allTargets();
    expect(all).toHaveLength(1 + SITE_PAGES.length + HELP_ARTICLES.length + SITE_PACKS.length);
    for (const t of all) for (const lang of ["en", "te", "hi", "kn", "ta"] as const) {
      const path = sitePath(lang, t);
      const seg = path.split("/").filter(Boolean);
      expect(resolveSite(lang === "en" ? seg : seg), path).toEqual({ lang, target: t });
    }
  });
});
