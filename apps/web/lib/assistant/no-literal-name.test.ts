import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Job DN: the assistant's name is never written into the product. Every user-visible mention is the placeholder `{assistant}` in a string (or `currentAssistantName()` in code), and the only place that says what the default
 * is is lib/assistant/name.ts. This reads the shipped files (code without its comments, the strings, the pack texts, the static pages) and fails on the old name or the default name written out. Tests may name Vijaya: they pin the default.
 */
const WEB = join(__dirname, "..", "..");
const ROOT = join(WEB, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "__text__", "coverage", "test-results"]);
const NAME_FILE = join(WEB, "lib", "assistant", "name.ts");
const WRITTEN = /Agent\s+OWL|Vijaya|\bVani\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Code without its comments: block comments, whole-line comments and trailing `// ...` after a space (an address like https:// has no space before it). */
const withoutComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f) || /-test-kit\.tsx?$/.test(f) || f.includes(`${join("test", "")}`);

describe("the assistant's name is read through the helper, never written", () => {
  const code = ["app", "components", "lib", "i18n", "design", "scripts"].flatMap((d) => walk(join(WEB, d))).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !isTest(f) && f !== NAME_FILE);
  const data = [...walk(join(WEB, "i18n", "strings")).filter((f) => f.endsWith(".json")), ...walk(join(WEB, "public", "offline")), join(WEB, "lib", "site", "site-packs.generated.json"), ...["textiles", "construction_materials", "education"].map((p) => join(ROOT, "packages", "packs", p, "landing.json"))];

  it("finds the files it is meant to check", () => {
    expect(code.length).toBeGreaterThan(300);
    expect(data.length).toBeGreaterThan(8);
  });

  it("no code file writes the old name or the default name (comments aside)", () => {
    const bad = code.filter((f) => WRITTEN.test(withoutComments(readFileSync(f, "utf8")))).map((f) => relative(WEB, f));
    expect(bad).toEqual([]);
  });

  it("no string file, pack text or static page writes the old name or the default name", () => {
    const bad = data.filter((f) => WRITTEN.test(readFileSync(f, "utf8"))).map((f) => relative(WEB, f));
    expect(bad).toEqual([]);
  });

  it("the default name is written in exactly one place", () => {
    expect(readFileSync(NAME_FILE, "utf8").match(/"Vijaya"/g)).toHaveLength(1);
  });
});
