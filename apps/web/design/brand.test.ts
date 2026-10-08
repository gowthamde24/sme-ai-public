import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_NAME, BRAND_TEXT } from "@/design/brand";

const root = path.resolve(import.meta.dirname, "..");
const walk = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

describe("the brand name is one constant", () => {
  it("is the working name, with the joiner only in the running-text form", () => {
    expect(BRAND_NAME).toBe("Sme-AI (working name)");
    expect(BRAND_TEXT).toBe("Sme-⁠AI (working name)");
    expect(BRAND_TEXT.replaceAll("⁠", "")).toBe(BRAND_NAME);
  });
  it("appears as a literal nowhere else in v2 source, the landing route or the string store", () => {
    const dirs = ["components/v2", "app/landing", "design", "i18n"].map((d) => path.join(root, d));
    const offenders = dirs
      .flatMap(walk)
      .filter((f) => /\.(tsx?|css|json|mjs)$/.test(f) && !/brand\.ts$|\.test\.tsx?$|\.csv$|STYLE\.md$/.test(f))
      .filter((f) => /sme-?ai/i.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
