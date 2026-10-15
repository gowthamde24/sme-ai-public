import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";

/**
 * String completeness of the screens of the night run (jobs CO to CU): every string KEY a screen names in its source must exist in the store, in all four languages, and every family a screen builds a key from
 * (`camp.status.${x}`) must have members. A missing key draws a raw key on a person's screen (or, in a typed call, fails the build; here it also fails for the calls the types cannot see, the `words["..."]` reads and
 * the `say(words, ...)` calls on a table of words). Only the prefixes these jobs own are checked, so a page that reads another dictionary is not a false alarm.
 */
const OWNED = /^(camp|edu|fee|rep|due|mat|site|trip|today\.pack|nav\.tab|start\.check|dta\.(field|kind|reason|issue|import|done)|ask\.can|ask\.chip|report\.(sarees|title))[.]/;
const ROOTS = ["app", "components", "lib"];
const dict = app as Record<string, { en: string; te: string; hi: string; kn: string }>;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|d)\./.test(e.name) ? [full] : [];
  });
}

const literal = /(?:say\(\s*\w+\s*,\s*|\bt\(\s*|\bword\(\s*\w+\s*,\s*|\bwords\[\s*|\bw\(\s*)["'`]([a-z][\w.]*\.[\w.]+)["'`]/g;
const ternary = /\?\s*["'`]([a-z][\w.]*\.[\w.]+)["'`]\s*:\s*["'`]([a-z][\w.]*\.[\w.]+)["'`]/g;
const family = /`([a-z][a-z0-9]*(?:\.[a-z0-9_]+)+\.)\$\{/g;

const found = new Map<string, Set<string>>();
const families = new Map<string, Set<string>>();
for (const root of ROOTS) {
  for (const file of sources(path.join(process.cwd(), root))) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    const add = (map: Map<string, Set<string>>, key: string) => map.set(key, (map.get(key) ?? new Set()).add(rel));
    for (const m of src.matchAll(literal)) if (OWNED.test(m[1])) add(found, m[1]);
    for (const m of src.matchAll(ternary)) for (const k of [m[1], m[2]]) if (OWNED.test(k)) add(found, k);
    for (const m of src.matchAll(family)) if (OWNED.test(m[1])) add(families, m[1]);
  }
}

describe("the strings the screens name exist, in four languages", () => {
  it("finds the keys it polices (several hundred)", () => {
    expect(found.size).toBeGreaterThan(300);
    expect(families.size).toBeGreaterThan(30);
  });
  it("every key a screen names is in the store", () => {
    const missing = [...found].filter(([k]) => !(k in dict)).map(([k, files]) => `${k} (${[...files][0]})`);
    expect(missing).toEqual([]);
  });
  it("every key has words in all four languages", () => {
    const empty = [...found.keys()].filter((k) => k in dict && !(dict[k].en && dict[k].te && dict[k].hi && dict[k].kn));
    expect(empty).toEqual([]);
  });
  it("every family a screen builds a key from has members", () => {
    const keys = Object.keys(dict);
    const bare = [...families].filter(([prefix]) => !keys.some((k) => k.startsWith(prefix))).map(([prefix, files]) => `${prefix} (${[...files][0]})`);
    expect(bare).toEqual([]);
  });
});
