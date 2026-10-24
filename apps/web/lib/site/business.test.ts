// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADDRESSES, ADDRESS_KEYS, BUSINESS, CANONICAL_ORIGIN, DOMAIN, GRIEVANCE_DAYS, GRIEVANCE_OFFICER, LEGAL_TOKENS } from "./business";

const WEB = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(WEB, "../..");

describe("the one place for the domain and the addresses (job DB)", () => {
  it("is stack19.com with the four addresses of the owner, and nothing else", () => {
    expect(DOMAIN).toBe("stack19.com");
    expect(CANONICAL_ORIGIN).toBe("https://stack19.com");
    expect(ADDRESS_KEYS).toEqual(["hello", "support", "billing", "privacy"]);
    expect(ADDRESSES).toEqual({ hello: "hello@stack19.com", support: "support@stack19.com", billing: "billing@stack19.com", privacy: "privacy@stack19.com" });
  });
  it("names the Grievance Officer and the 30-day promise", () => {
    expect(BUSINESS.proprietor).toBe("Gowtham Reddy Sodanapalli");
    expect(BUSINESS.description).toMatch(/sole proprietorship of Gowtham Reddy Sodanapalli.*GST.*Andhra Pradesh/);
    expect(GRIEVANCE_OFFICER).toEqual({ name: "Gowtham Reddy Sodanapalli", email: "privacy@stack19.com" });
    expect(GRIEVANCE_DAYS).toBe(30);
    expect(LEGAL_TOKENS.grievance_days).toBe("30");
  });
  it("publishes no phone number and no postal address", () => {
    const text = JSON.stringify([BUSINESS, ADDRESSES, LEGAL_TOKENS]);
    expect(text).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
    expect(text).not.toMatch(/\b(street|road|nagar|pin ?code|flat|door no)\b/i);
  });

  it("no source file of the web app, the API or the deploy files writes a stack19.com address or a personal address: they read lib/site/business.ts", () => {
    const skip = new Set(["node_modules", ".next", ".venv", "coverage", ".git", "__pycache__", "shots", "test-results"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (skip.has(e)) continue;
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|json|mjs|toml|html|py|sh)$/.test(e) && !/\.test\.|package-lock/.test(e)) files.push(full);
      }
    };
    for (const root of [path.join(WEB, "app"), path.join(WEB, "components"), path.join(WEB, "lib"), path.join(WEB, "i18n"), path.join(WEB, "public"), path.join(REPO, "services", "ai-api", "app"), path.join(REPO, "supabase", "templates"), path.join(REPO, "deploy")]) walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      if (f === path.join(WEB, "lib", "site", "business.ts")) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@(?:stack19\.com|gmail\.com|outlook\.com|yahoo\.[a-z.]+|hotmail\.com|icloud\.com)\b/gi)) offenders.push(`${path.relative(REPO, f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
