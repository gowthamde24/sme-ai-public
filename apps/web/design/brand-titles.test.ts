// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND_NAME } from "./brand";

const WEB = path.resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) return e === "node_modules" || e === ".next" ? [] : sources(full);
    return /\.(tsx?|mjs)$/.test(e) && !/\.test\./.test(e) ? [full] : [];
  });
}

describe("the product name in titles and visible text (job DD)", () => {
  it("no page of the web app (or its audit scripts) writes the old product name: every title reads the brand from design/brand.ts", () => {
    const offenders = [...sources(path.join(WEB, "app")), ...sources(path.join(WEB, "components")), ...sources(path.join(WEB, "lib")), ...sources(path.join(WEB, "scripts"))].filter((f) => /SME AI Revenue Engine|Sme-AI \(working name\)/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(WEB, f))).toEqual([]);
  });
  it("every page title that names the product does it through BRAND_NAME, and the page imports it", () => {
    const pages = sources(path.join(WEB, "app")).filter((f) => /[\\/]page\.tsx$|layout\.tsx$/.test(f));
    let n = 0;
    for (const f of pages) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/title: (`[^`]*`|"[^"]*"),?/g)) {
        if (m[1].startsWith("`") && m[1].includes("${BRAND_NAME}")) {
          n++;
          expect(text, path.relative(WEB, f)).toMatch(/import \{[^}]*\bBRAND_NAME\b[^}]*\} from "@\/design\/brand"/);
        }
      }
    }
    expect(n).toBeGreaterThan(90); // 93 page titles at the time of the rename
    expect(BRAND_NAME).toBe("Stack19");
  });
  it("the settings page title reads 'Settings · Stack19'", () => {
    const text = readFileSync(path.join(WEB, "app", "app", "tenants", "[tenantId]", "settings", "page.tsx"), "utf8");
    expect(text).toContain("title: `Settings · ${BRAND_NAME}`");
  });
});
