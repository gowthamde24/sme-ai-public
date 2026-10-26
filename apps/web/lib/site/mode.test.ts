import { describe, expect, it } from "vitest";

import { indexableFor } from "@/lib/seo/index-rule";

import { isClosedPath, isPublicHost, isServed, siteMode, WEBSITE_PAGES } from "./mode";
import { SITE_PAGES } from "./paths";
import { allTargets } from "./routes";

describe("website mode (job DQ)", () => {
  it("only SITE_MODE=website turns it on; anything else is the usual behaviour", () => {
    expect(siteMode("website")).toBe("website");
    for (const v of [undefined, "", "app", "Website", "1", "true", " website"]) expect(siteMode(v)).toBe("app");
  });

  it("serves the home page, the three business pages, plans, contact and nothing else of the site", () => {
    const served = allTargets().filter((t) => isServed(t, "website"));
    expect(served).toEqual(allTargets().filter((t) => t.kind !== "page" || t.page === "pricing" || t.page === "contact"));
    expect(served.filter((t) => t.kind === "pack").map((t) => (t as { slug: string }).slug).sort()).toEqual(["construction", "education", "textiles"]);
    expect([...WEBSITE_PAGES].sort()).toEqual(["contact", "pricing"]);
    for (const page of SITE_PAGES.filter((p) => !WEBSITE_PAGES.includes(p))) expect(isServed({ kind: "page", page }, "website")).toBe(false);
  });

  it("serves every page in the usual mode", () => {
    for (const t of allTargets()) expect(isServed(t, "app")).toBe(true);
  });

  it("closes the app and every sign-in address, and only those", () => {
    for (const p of ["/app", "/app/tenants/1/today", "/login", "/signup", "/signup/check-email", "/setup", "/auth", "/auth/mfa"]) expect(isClosedPath(p), p).toBe(true);
    for (const p of ["/", "/te", "/pricing", "/contact", "/privacy", "/terms", "/data-deletion", "/opening-soon", "/loginx", "/construction"]) expect(isClosedPath(p), p).toBe(false);
    expect(isClosedPath("/appendix")).toBe(true); // the proxy treats every "/app..." address as the app
  });

  it("only stack19.com and www.stack19.com are the public hosts", () => {
    for (const h of ["stack19.com", "www.stack19.com", "STACK19.com", "stack19.com:443"]) expect(isPublicHost(h), h).toBe(true);
    for (const h of ["sme-web-xyz.a.run.app", "stack19.com.evil.example", "staging.stack19.com", "localhost:3000", "", null, undefined]) expect(isPublicHost(h), String(h)).toBe(false);
  });

  it("indexing: website mode on a public host, or the old launch switch; never staging", () => {
    expect(indexableFor("stack19.com", "website", false)).toBe(true);
    expect(indexableFor("www.stack19.com", "website", false)).toBe(true);
    expect(indexableFor("sme-web-1.a.run.app", "website", false)).toBe(false); // staging stays noindex
    expect(indexableFor("stack19.com", "app", false)).toBe(false); // the usual mode is closed until the launch switch
    expect(indexableFor("anything", "app", true)).toBe(true);
    expect(indexableFor(null, "website", false)).toBe(false);
  });
});
