// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADDRESSES, ADDRESS_KEYS, BUSINESS, CANONICAL_ORIGIN, DOMAIN, GRIEVANCE_OFFICER, LEGAL_TOKENS, RESPONSE_DAYS } from "./business";

const WEB = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(WEB, "../..");

describe("the one place for the domain and the addresses (job DB)", () => {
  it("is stack19.com with the four addresses of the owner, and nothing else", () => {
    expect(DOMAIN).toBe("stack19.com");
    expect(CANONICAL_ORIGIN).toBe("https://stack19.com");
    expect(ADDRESS_KEYS).toEqual(["hello", "support", "billing", "privacy"]);
    expect(ADDRESSES).toEqual({ hello: "hello@stack19.com", support: "support@stack19.com", billing: "billing@stack19.com", privacy: "privacy@stack19.com" });
  });
  it("names the Grievance Officer and the two response times: 7 days to access, correct or erase, 30 days for any other grievance (owner decision of 24 October)", () => {
    expect(BUSINESS.proprietor).toBe("Gowtham Reddy Sodanapalli");
    expect(BUSINESS.description).toMatch(/sole proprietorship of Gowtham Reddy Sodanapalli.*GST.*Andhra Pradesh/);
    expect(GRIEVANCE_OFFICER).toEqual({ name: "Gowtham Reddy Sodanapalli", email: "privacy@stack19.com" });
    expect(RESPONSE_DAYS).toEqual({ requests: 7, grievances: 30 });
    expect(LEGAL_TOKENS.request_days).toBe("7");
    expect(LEGAL_TOKENS.grievance_days).toBe("30");
  });
  it("publishes no phone number and no postal address", () => {
    const text = JSON.stringify([BUSINESS, ADDRESSES, LEGAL_TOKENS]);
    expect(text).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
    expect(text).not.toMatch(/\b(street|road|nagar|pin ?code|flat|door no)\b/i);
  });

  it("no response-time number is written outside this file: the legal texts, the data-deletion page, the summaries and the contact page use the {request_days} and {grievance_days} tokens", () => {
    const lib = path.join(WEB, "lib", "legal");
    const raw = readdirSync(lib).filter((f) => /^(privacy|data-deletion)-text(\.(te|hi|kn))?\.ts$/.test(f)).map((f) => ({ name: `lib/legal/${f}`, text: readFileSync(path.join(lib, f), "utf8") }));
    expect(raw).toHaveLength(8);
    // a 7 or a 30 next to a word for "days", in any of the four languages (the 7-day backup line is a different number: it names backups)
    const days = /(?<![\d,.])(7|30)(?![\d,])\s*(days?|दिन|రోజ|ದಿನ)/;
    const offenders: string[] = [];
    for (const { name, text } of raw) text.split("\n").forEach((line, i) => days.test(line) && !/backup|बैकअप|బ్యాకప్|ಬ್ಯಾಕಪ್/i.test(line) && offenders.push(`${name}:${i + 1}`));
    const legal = JSON.parse(readFileSync(path.join(WEB, "i18n", "strings", "legal.json"), "utf8")) as Record<string, Record<string, string>>;
    const site = JSON.parse(readFileSync(path.join(WEB, "i18n", "strings", "site.json"), "utf8")) as Record<string, Record<string, string>>;
    for (const [set, name] of [[legal, "legal"], [site, "site"]] as const)
      for (const [key, entry] of Object.entries(set))
        if (/^(legal\.sum\.(privacy|deletion)\.|contact\.addr\.)/.test(key))
          for (const lang of ["en", "te", "hi", "kn"]) if (days.test(entry[lang]) && !/backup|बैकअप|బ్యాకప్|ಬ್ಯಾಕಪ್/i.test(entry[lang])) offenders.push(`${name}.json ${key} (${lang})`);
    expect(offenders).toEqual([]);
    const contact = readFileSync(path.join(WEB, "components", "v2", "site", "ContactPage.tsx"), "utf8");
    expect(contact).toContain("RESPONSE_DAYS.requests");
    expect(contact).not.toMatch(/\b(7|30)\b\s*days/);
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
