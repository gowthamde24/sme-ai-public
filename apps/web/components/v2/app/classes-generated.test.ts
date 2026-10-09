// @vitest-environment node
/**
 * Tailwind generates only the classes it finds under components/v2 (design/v2.css: @source "../components/v2"). A migrated screen in app/ takes
 * its classes from the constants of components/v2/app/ui.ts; a class typed straight into an app/ file would silently have no style. This test
 * finds every class token written in a className of an app/ file that uses the v2 pieces, and requires the token to exist in components/v2.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../../..");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const code = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);

const v2Text = walk(path.join(WEB, "components/v2")).filter(code).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const known = new Set(v2Text.split(/[\s"'`{}()<>=,;]+/).filter(Boolean));

describe("classes written in app files that use the v2 pieces", () => {
  const files = walk(path.join(WEB, "app")).filter(code).filter((f) => /@\/components\/v2\/app/.test(fs.readFileSync(f, "utf8")));
  it("there are migrated app files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files.map((f) => [path.relative(WEB, f), f]))("%s: every literal class exists in components/v2", (_name, file) => {
    const src = fs.readFileSync(file, "utf8");
    const missing: string[] = [];
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
      for (const token of text.split(/\s+/).filter(Boolean)) if (!known.has(token)) missing.push(token);
    }
    expect(missing).toEqual([]);
  });
});
