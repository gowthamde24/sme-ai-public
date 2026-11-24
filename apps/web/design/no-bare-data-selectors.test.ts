import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 25 Nov 2026: `design/jobs.css` and `design/ds.css` styled ANY `[data-status]` as a centred pill with a black mask icon, and ten components that use `data-status` for a state (Lead sources cards, Outbox rows, Visits, Tasks...) turned
 * into black squares and cut-off text. A global rule must never be keyed on the mere PRESENCE of a generic data attribute (a value such as [data-status="live"] only matches that value, which is fine): key it on an element AND a class (`span[data-status]`, `.pill[data-status]`) or under a `[data-part]`.
 */
const GENERIC = "status|state|card|template|kind|type|tone|variant";
const SHELL = /^(\[data-(ui|ds|jobs|theme|frame|open)(="[^"]*")?\]\s*)+/;

describe("global CSS is not keyed on a bare generic data attribute", () => {
  const files = readdirSync(join(__dirname)).filter((f) => f.endsWith(".css"));
  it("has CSS files to check", () => expect(files.length).toBeGreaterThan(3));
  for (const f of files) {
    it(f, () => {
      const css = readFileSync(join(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const bad: string[] = [];
      for (const m of css.matchAll(/([^{}]+)\{/g)) {
        for (let sel of m[1].split(",")) {
          sel = sel.trim().replace(/^:is\(/, "").replace(/^@[^{]*$/, "");
          const rest = sel.replace(SHELL, "");
          if (new RegExp(`^\\[data-(${GENERIC})\\]`).test(rest)) bad.push(sel);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
